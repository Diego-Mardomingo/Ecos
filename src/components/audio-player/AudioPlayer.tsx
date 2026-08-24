"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle, memo } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { createYoutubePlayer, type YTPlayer } from "@/lib/youtube-player";

type AudioSource = "youtube" | "preview";

export interface AudioPlayerHandle {
  togglePlay: () => void;
  /** Si está reproduciendo, pausa y resetea el fragmento (mismo efecto que pulsar Stop). */
  stopIfPlaying: () => void;
}

interface AudioPlayerProps {
  youtubeId: string;
  previewUrl?: string; // Spotify preview MP3 (fallback si no hay YouTube)
  maxDuration: number;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onLoadedChange?: (isLoaded: boolean) => void;
  /** Cuando true, no se muestra la barra ni el botón (el padre dibuja el control grande) */
  hideControls?: boolean;
  className?: string;
}

const AudioPlayerComponent = ({
  youtubeId,
  previewUrl,
  maxDuration,
  onEnded,
  onTimeUpdate,
  onPlayingChange,
  onLoadedChange,
  hideControls = false,
  className,
}: AudioPlayerProps,
ref: React.Ref<AudioPlayerHandle>) => {
  const t = useTranslations("game");
  /** Se resuelve aqui porque dentro de `togglePlay` hay un `t` local que sombrea el del hook. */
  const fragmentTitle = t("audioFragment");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** id de requestAnimationFrame para el bucle de progreso (preview / YouTube) */
  const playbackRafRef = useRef<number | null>(null);
  /** setTimeout de hard-stop absoluto — fallback cuando RAF se throttlea en móvil */
  const stopTimeoutRef = useRef<number | null>(null);
  /** setInterval que mantiene Media Session suprimida mientras YouTube reproduce */
  const mediaSessionSuppressRef = useRef<number | null>(null);

  const cancelHardStop = useCallback(() => {
    if (stopTimeoutRef.current !== null) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
  }, []);

  const cancelMediaSessionSuppress = useCallback(() => {
    if (mediaSessionSuppressRef.current !== null) {
      clearInterval(mediaSessionSuppressRef.current);
      mediaSessionSuppressRef.current = null;
    }
  }, []);

  const cancelPlaybackLoop = useCallback(() => {
    if (playbackRafRef.current !== null) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    }
  }, []);
  const sourceRef = useRef<AudioSource | null>(null);
  /** Listener "ended" activo del preview, para poder retirarlo y no acumularlos. */
  const endedHandlerRef = useRef<(() => void) | null>(null);
  const maxDurationRef = useRef(maxDuration);
  const [isPlaying, setIsPlaying] = useState(false);
  /**
   * Solo alimenta los controles propios del reproductor. Con `hideControls` no se pinta, y el
   * bucle de progreso corre a 60 fps, así que ahí no se toca: quien dibuja es el padre a través
   * de `onTimeUpdate`.
   */
  const [currentTime, setCurrentTime] = useState(0);
  const setCurrentTimeIfVisible = useCallback(
    (value: number) => {
      if (hideControls) return;
      setCurrentTime(value);
    },
    [hideControls]
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const isPlayingRef = useRef(false);
  const isLoadedRef = useRef(false);

  // Espejos del último valor, para que los callbacks imperativos (rAF, handlers de
  // <audio>, el handle expuesto por ref) los lean sin recrearse en cada cambio.
  // Se escriben tras el commit y no durante el render, que rompe las garantías
  // del compilador de React.
  useEffect(() => {
    maxDurationRef.current = maxDuration;
    isPlayingRef.current = isPlaying;
    isLoadedRef.current = isLoaded;
  });

  const updateMediaSessionPosition = useCallback((position: number) => {
    if (typeof navigator !== "undefined" && "mediaSession" in navigator && sourceRef.current === "preview") {
      try {
        navigator.mediaSession.setPositionState({
          duration: maxDurationRef.current,
          playbackRate: 1,
          position: Math.min(position, maxDurationRef.current),
        });
      } catch {
        // ignore
      }
    }
  }, []);

  const clearMediaSession = useCallback(() => {
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      try {
        navigator.mediaSession.setPositionState();
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
        navigator.mediaSession.setActionHandler("seekto", null);
      } catch {
        // ignore
      }
    }
  }, []);

  /** Inicia un interval que mantiene la Media Session suprimida mientras YouTube reproduce.
   *  YouTube IFrame API puede sobreescribir metadata/playbackState de forma asíncrona. */
  const startMediaSessionSuppress = useCallback(() => {
    cancelMediaSessionSuppress();
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const suppress = () => {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      } catch {
        // ignore
      }
    };
    suppress();
    mediaSessionSuppressRef.current = window.setInterval(suppress, 300);
  }, [cancelMediaSessionSuppress]);

  /** Declarado aquí, antes del efecto de montaje del reproductor, porque ese efecto
   *  lo usa: si se declara después queda en zona muerta temporal y la referencia
   *  capturada no se actualiza cuando cambia. */
  const stopAndReset = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.stopVideo();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      if (endedHandlerRef.current) {
        audioRef.current.removeEventListener("ended", endedHandlerRef.current);
        endedHandlerRef.current = null;
      }
    }
    cancelPlaybackLoop();
    cancelHardStop();
    cancelMediaSessionSuppress();
    setCurrentTime(0);
    setIsPlaying(false);
    clearMediaSession();
    onTimeUpdate?.(0);
  }, [cancelPlaybackLoop, cancelHardStop, cancelMediaSessionSuppress, clearMediaSession, onTimeUpdate]);

  useEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  useEffect(() => {
    onLoadedChange?.(isLoaded);
  }, [isLoaded, onLoadedChange]);

  const source: AudioSource | null =
    previewUrl ? "preview" : youtubeId ? "youtube" : null;

  // Reset al cambiar de pista, ajustando el estado durante el render en lugar de
  // en el efecto de montaje del reproductor. En el primer render no hace nada,
  // porque estos son ya los valores iniciales.
  const trackKey = `${youtubeId ?? ""}|${previewUrl ?? ""}`;
  const [lastTrackKey, setLastTrackKey] = useState(trackKey);
  if (trackKey !== lastTrackKey) {
    setLastTrackKey(trackKey);
    setIsLoaded(false);
    setHasError(false);
    setCurrentTime(0);
    setIsPlaying(false);
  }

  useEffect(() => {
    if (!source) return;

    sourceRef.current = source;

    if (source === "youtube") {
      const wrapper = document.createElement("div");
      wrapper.style.cssText =
        "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;";
      document.body.appendChild(wrapper);

      // Guard anti-carrera: si el componente se desmonta antes de que el player
      // resuelva, destruimos el player y no tocamos estado (evita iframe huérfano
      // y setState tras unmount).
      let cancelled = false;

      createYoutubePlayer({
        videoId: youtubeId,
        containerRef: { current: wrapper },
      })
        .then((player) => {
          if (cancelled) {
            player.destroy();
            wrapper.remove();
            return;
          }
          playerRef.current = player;
          setIsLoaded(true);
        })
        .catch(() => {
          wrapper.remove();
        });

      return () => {
        cancelled = true;
        if (playbackRafRef.current !== null) {
          cancelAnimationFrame(playbackRafRef.current);
          playbackRafRef.current = null;
        }
        if (stopTimeoutRef.current !== null) {
          clearTimeout(stopTimeoutRef.current);
          stopTimeoutRef.current = null;
        }
        if (mediaSessionSuppressRef.current !== null) {
          clearInterval(mediaSessionSuppressRef.current);
          mediaSessionSuppressRef.current = null;
        }
        if (playerRef.current) {
          playerRef.current.stopVideo();
          playerRef.current.destroy();
          playerRef.current = null;
        }
        wrapper.remove();
      };
    }

    if (source === "preview" && previewUrl) {
      const audio = new Audio(previewUrl);
      audioRef.current = audio;

      const onLoaded = () => setIsLoaded(true);
      const onError = () => {
        audioRef.current = null;
        setHasError(true);
      };

      const clampPreviewTime = () => {
        const max = maxDurationRef.current;
        if (audio.currentTime > max) {
          audio.currentTime = max;
          audio.pause();
          stopAndReset();
        }
      };

      const onSeeking = () => {
        const max = maxDurationRef.current;
        if (audio.currentTime > max) {
          audio.currentTime = max;
          audio.pause();
          stopAndReset();
        }
      };

      const onTimeUpdate = () => clampPreviewTime();

      audio.addEventListener("loadeddata", onLoaded, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.addEventListener("seeking", onSeeking);
      audio.addEventListener("timeupdate", onTimeUpdate);
      audio.load();

      return () => {
        audio.removeEventListener("loadeddata", onLoaded);
        audio.removeEventListener("error", onError);
        audio.removeEventListener("seeking", onSeeking);
        audio.removeEventListener("timeupdate", onTimeUpdate);
        if (endedHandlerRef.current) {
          audio.removeEventListener("ended", endedHandlerRef.current);
          endedHandlerRef.current = null;
        }
        if (playbackRafRef.current !== null) {
          cancelAnimationFrame(playbackRafRef.current);
          playbackRafRef.current = null;
        }
        if (stopTimeoutRef.current !== null) {
          clearTimeout(stopTimeoutRef.current);
          stopTimeoutRef.current = null;
        }
        audio.pause();
        audio.src = "";
        audioRef.current = null;
        clearMediaSession();
      };
    }
  }, [youtubeId, previewUrl, source, clearMediaSession, stopAndReset]);

  const stopIfPlaying = useCallback(() => {
    if (!isLoadedRef.current || !isPlayingRef.current) return;

    if (sourceRef.current === "youtube") {
      playerRef.current?.stopVideo();
      stopAndReset();
      return;
    }

    if (sourceRef.current === "preview") {
      audioRef.current?.pause();
      stopAndReset();
    }
  }, [stopAndReset]);

  const togglePlay = useCallback(() => {
    if (!isLoaded) return;

    if (sourceRef.current === "youtube") {
      const player = playerRef.current;
      if (!player) return;

      if (isPlaying) {
        player.stopVideo();
        stopAndReset();
        return;
      }

      // cueVideoById respeta endSeconds internamente (YouTube corta por su lado)
      player.cueVideoById({ videoId: youtubeId, startSeconds: 0, endSeconds: maxDuration });
      player.playVideo();
      setIsPlaying(true);

      // Suprimir Media Session: YouTube IFrame API registra el título real del video
      startMediaSessionSuppress();

      // Hard-stop absoluto: fallback para cuando RAF se throttlea en móvil
      cancelHardStop();
      stopTimeoutRef.current = window.setTimeout(() => {
        stopAndReset();
        onEnded?.();
      }, (maxDuration + 0.5) * 1000);

      cancelPlaybackLoop();
      const tickYoutube = () => {
        const p = playerRef.current;
        if (!p) return;
        const seek = p.getCurrentTime();
        if (seek >= maxDuration) {
          cancelPlaybackLoop();
          p.stopVideo();
          onTimeUpdate?.(maxDuration);
          setTimeout(() => {
            stopAndReset();
            onEnded?.();
          }, 120);
          return;
        }
        setCurrentTimeIfVisible(seek);
        onTimeUpdate?.(seek);
        playbackRafRef.current = requestAnimationFrame(tickYoutube);
      };
      playbackRafRef.current = requestAnimationFrame(tickYoutube);
      return;
    }

    if (sourceRef.current === "preview") {
      const audio = audioRef.current;
      if (!audio) return;

      if (isPlaying) {
        audio.pause();
        stopAndReset();
        return;
      }

      audio.currentTime = 0;
      // play() puede rechazar en iOS/Safari (autoplay bloqueado, o stop inmediato):
      // manejarlo para no quedar con isPlaying=true sin audio.
      void audio.play().catch(() => {
        setIsPlaying(false);
        cancelHardStop();
        cancelPlaybackLoop();
      });
      setIsPlaying(true);

      const onEndedNative = () => {
        cancelPlaybackLoop();
        stopAndReset();
        onEnded?.();
      };
      // Retirar cualquier listener previo para no acumularlos entre ciclos play/stop.
      if (endedHandlerRef.current) {
        audio.removeEventListener("ended", endedHandlerRef.current);
      }
      endedHandlerRef.current = onEndedNative;
      audio.addEventListener("ended", onEndedNative);

      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            // Sale en la pantalla de bloqueo del movil, asi que va traducido.
            // Ojo: el handler de "seekto" de mas abajo declara su propio `t`, que sombrea
            // el de useTranslations; este uso queda fuera de ese ambito a proposito.
            title: fragmentTitle,
            artist: "",
            album: "",
          });
          // playbackState "none" evita que aparezca en controles del sistema
          navigator.mediaSession.playbackState = "none";
          updateMediaSessionPosition(0);
          navigator.mediaSession.setActionHandler("seekto", (details) => {
            const audio = audioRef.current;
            if (!audio || sourceRef.current !== "preview") return;
            const t = details.seekTime ?? 0;
            const clamped = Math.min(Math.max(0, t), maxDuration);
            audio.currentTime = clamped;
            setCurrentTime(clamped);
            onTimeUpdate?.(clamped);
            updateMediaSessionPosition(clamped);
          });
        } catch {
          // ignore
        }
      }

      // Hard-stop absoluto: fallback para cuando RAF se throttlea en móvil
      cancelHardStop();
      stopTimeoutRef.current = window.setTimeout(() => {
        stopAndReset();
        onEnded?.();
      }, (maxDuration + 0.5) * 1000);

      cancelPlaybackLoop();
      const tickPreview = () => {
        const a = audioRef.current;
        if (!a) return;
        const seek = a.currentTime;
        const clamped = Math.min(seek, maxDuration);
        if (clamped < seek) {
          a.currentTime = clamped;
          a.pause();
        }
        if (seek >= maxDuration) {
          cancelPlaybackLoop();
          a.pause();
          onTimeUpdate?.(maxDuration);
          updateMediaSessionPosition(maxDuration);
          setTimeout(() => {
            stopAndReset();
            onEnded?.();
          }, 120);
          return;
        }
        setCurrentTimeIfVisible(seek);
        onTimeUpdate?.(seek);
        updateMediaSessionPosition(seek);
        playbackRafRef.current = requestAnimationFrame(tickPreview);
      };
      playbackRafRef.current = requestAnimationFrame(tickPreview);
    }
  }, [cancelPlaybackLoop, cancelHardStop, isPlaying, isLoaded, maxDuration, youtubeId, stopAndReset, startMediaSessionSuppress, onEnded, onTimeUpdate, updateMediaSessionPosition, setCurrentTimeIfVisible, fragmentTitle]);

  useImperativeHandle(ref, () => ({
    togglePlay,
    stopIfPlaying,
  }), [togglePlay, stopIfPlaying]);

  if (!source || hasError) {
    return (
      <div className={cn("rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive", className)}>
        {t("noAudio")}
      </div>
    );
  }

  const progress = Math.min((currentTime / maxDuration) * 100, 100);
  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  if (hideControls) {
    return <div ref={containerRef} aria-hidden className="sr-only" />;
  }

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div className="w-full space-y-1">
        <div
          role="progressbar"
          aria-label={t("audioFragment")}
          aria-valuemin={0}
          aria-valuemax={Math.round(maxDuration)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} / ${formatTime(maxDuration)}`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            aria-hidden
            className="h-full rounded-full bg-brand"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span
            className={cn("font-medium", isPlaying && "text-brand animate-pulse")}
          >
            {isPlaying ? t("listening") : t("pressPlay")}
          </span>
          <span>
            {formatTime(currentTime)} / {formatTime(maxDuration)}
          </span>
        </div>
      </div>

      {/* El contenido es una ligadura de Material Symbols ("stop" / "play_arrow"), que el lector
          de pantalla leeria literalmente: va oculta y el nombre lo da el aria-label. */}
      <motion.button
        type="button"
        onClick={togglePlay}
        whileTap={{ scale: 0.92 }}
        disabled={!isLoaded}
        aria-label={
          !isLoaded ? t("loadingAudio") : isPlaying ? t("stopFragment") : t("playFragment")
        }
        className={cn(
          "flex h-16 w-16 items-center justify-center rounded-full transition-all",
          isLoaded
            ? "bg-brand shadow-lg shadow-brand/30 active:shadow-brand/20"
            : "bg-muted cursor-not-allowed opacity-50"
        )}
      >
        {isLoaded ? (
          <span
            aria-hidden
            className="material-symbols-outlined text-3xl text-primary-foreground"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {isPlaying ? "stop" : "play_arrow"}
          </span>
        ) : (
          <span aria-hidden className="material-symbols-outlined animate-spin text-2xl text-muted-foreground">
            progress_activity
          </span>
        )}
      </motion.button>
      <div ref={containerRef} aria-hidden className="sr-only" />
    </div>
  );
};

/**
 * `memo` para que un re-render del padre no arrastre al reproductor: monta el iframe de YouTube y
 * el <audio>, y sus props son estables mientras dura la partida.
 */
export const AudioPlayer = memo(forwardRef(AudioPlayerComponent));
