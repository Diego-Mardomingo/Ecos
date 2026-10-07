"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle, memo } from "react";
import { useTranslations } from "next-intl";
import { m } from "framer-motion";
import { cn } from "@/lib/utils";

export interface AudioPlayerHandle {
  togglePlay: () => void;
  /** Si está reproduciendo, pausa y resetea el fragmento (mismo efecto que pulsar Stop). */
  stopIfPlaying: () => void;
  /**
   * Lleva el cabezal a ese segundo, sin reproducir ni parar. Sonando, salta y sigue; parado, el
   * siguiente play arranca desde ahí. Se acota al fragmento disponible (`maxDuration`).
   */
  seekTo: (seconds: number) => void;
  /** Vuelve a cargar el audio después de un fallo de carga (UX-06). */
  retry: () => void;
}

interface AudioPlayerProps {
  /** Preview MP3 de Spotify, servido a través de /api/audio-proxy. Única fuente de audio. */
  previewUrl?: string;
  maxDuration: number;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onLoadedChange?: (isLoaded: boolean) => void;
  /** Avisa cuando la carga del audio falla (red, proxy caído…) y cuando deja de estar fallida. */
  onErrorChange?: (failed: boolean) => void;
  /** Cuando true, no se muestra la barra ni el botón (el padre dibuja el control grande) */
  hideControls?: boolean;
  className?: string;
}

const AudioPlayerComponent = ({
  previewUrl,
  maxDuration,
  onEnded,
  onTimeUpdate,
  onPlayingChange,
  onLoadedChange,
  onErrorChange,
  hideControls = false,
  className,
}: AudioPlayerProps,
ref: React.Ref<AudioPlayerHandle>) => {
  const t = useTranslations("game");
  /** Se resuelve aqui porque dentro de `togglePlay` hay un `t` local que sombrea el del hook. */
  const fragmentTitle = t("audioFragment");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** id de requestAnimationFrame para el bucle de progreso */
  const playbackRafRef = useRef<number | null>(null);
  /** setTimeout de hard-stop absoluto — fallback cuando RAF se throttlea en móvil */
  const stopTimeoutRef = useRef<number | null>(null);

  const cancelHardStop = useCallback(() => {
    if (stopTimeoutRef.current !== null) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
  }, []);

  const cancelPlaybackLoop = useCallback(() => {
    if (playbackRafRef.current !== null) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    }
  }, []);
  /** Listener "ended" activo del preview, para poder retirarlo y no acumularlos. */
  const endedHandlerRef = useRef<(() => void) | null>(null);
  const maxDurationRef = useRef(maxDuration);
  /** Segundo desde el que arrancará el siguiente play, fijado por `seekTo` con el audio parado. */
  const pendingStartRef = useRef(0);
  const onEndedRef = useRef(onEnded);
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
  /**
   * Se incrementa en cada reintento: el efecto que crea el `<audio>` depende de él, así que un
   * reintento monta un elemento nuevo. Antes, si fallaba la carga, el botón se quedaba girando
   * para siempre y no había forma de volver a intentarlo sin recargar la página.
   */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const isPlayingRef = useRef(false);
  const isLoadedRef = useRef(false);

  // Espejos del último valor, para que los callbacks imperativos (rAF, handlers de
  // <audio>, el handle expuesto por ref) los lean sin recrearse en cada cambio.
  // Se escriben tras el commit y no durante el render, que rompe las garantías
  // del compilador de React.
  useEffect(() => {
    maxDurationRef.current = maxDuration;
    onEndedRef.current = onEnded;
    isPlayingRef.current = isPlaying;
    isLoadedRef.current = isLoaded;
  });

  const updateMediaSessionPosition = useCallback((position: number) => {
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
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

  /** Declarado aquí, antes del efecto de montaje del reproductor, porque ese efecto
   *  lo usa: si se declara después queda en zona muerta temporal y la referencia
   *  capturada no se actualiza cuando cambia. */
  const stopAndReset = useCallback(() => {
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
    pendingStartRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
    clearMediaSession();
    onTimeUpdate?.(0);
  }, [cancelPlaybackLoop, cancelHardStop, clearMediaSession, onTimeUpdate]);

  /**
   * Hard-stop absoluto: fallback para cuando RAF se throttlea en móvil. Se programa con lo que
   * *queda* de fragmento desde `fromSeconds`, no con el fragmento entero: tras un salto hacia
   * atrás, contar desde el play original cortaría el audio antes de tiempo.
   */
  const scheduleHardStop = useCallback(
    (fromSeconds: number) => {
      cancelHardStop();
      const remaining = Math.max(0, maxDurationRef.current - fromSeconds);
      stopTimeoutRef.current = window.setTimeout(() => {
        stopAndReset();
        onEndedRef.current?.();
      }, (remaining + 0.5) * 1000);
    },
    [cancelHardStop, stopAndReset]
  );

  useEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  useEffect(() => {
    onLoadedChange?.(isLoaded);
  }, [isLoaded, onLoadedChange]);

  useEffect(() => {
    onErrorChange?.(hasError);
  }, [hasError, onErrorChange]);

  // Reset al cambiar de pista, ajustando el estado durante el render en lugar de
  // en el efecto de montaje del reproductor. En el primer render no hace nada,
  // porque estos son ya los valores iniciales.
  const trackKey = previewUrl ?? "";
  const [lastTrackKey, setLastTrackKey] = useState(trackKey);
  if (trackKey !== lastTrackKey) {
    setLastTrackKey(trackKey);
    setIsLoaded(false);
    setHasError(false);
    setCurrentTime(0);
    setIsPlaying(false);
  }

  useEffect(() => {
    if (!previewUrl) return;

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
    // `loadAttempt` no se lee dentro: está para que un reintento vuelva a crear el `<audio>`.
  }, [previewUrl, loadAttempt, clearMediaSession, stopAndReset]);

  const retry = useCallback(() => {
    if (!previewUrl) return;
    setHasError(false);
    setIsLoaded(false);
    setIsPlaying(false);
    setLoadAttempt((n) => n + 1);
  }, [previewUrl]);

  const stopIfPlaying = useCallback(() => {
    if (!isLoadedRef.current || !isPlayingRef.current) return;
    audioRef.current?.pause();
    stopAndReset();
  }, [stopAndReset]);

  const togglePlay = useCallback(() => {
    if (!isLoaded) return;

    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      stopAndReset();
      return;
    }

    // Arranca donde lo dejó `seekTo` con el audio parado; si no hubo salto, desde el principio.
    const startAt = Math.min(pendingStartRef.current, Math.max(0, maxDuration - 0.05));
    pendingStartRef.current = 0;
    audio.currentTime = startAt;
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
        updateMediaSessionPosition(startAt);
        navigator.mediaSession.setActionHandler("seekto", (details) => {
          const audio = audioRef.current;
          if (!audio) return;
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

    scheduleHardStop(startAt);

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
  }, [cancelPlaybackLoop, cancelHardStop, isPlaying, isLoaded, maxDuration, stopAndReset, onEnded, onTimeUpdate, updateMediaSessionPosition, setCurrentTimeIfVisible, fragmentTitle, scheduleHardStop]);

  const seekTo = useCallback(
    (seconds: number) => {
      if (!isLoadedRef.current) return;
      const audio = audioRef.current;
      if (!audio) return;
      // Un pelo antes del final: caer justo en `maxDuration` dispararía el corte de fin de fragmento.
      const clamped = Math.min(Math.max(0, seconds), Math.max(0, maxDurationRef.current - 0.05));
      if (isPlayingRef.current) {
        audio.currentTime = clamped;
        scheduleHardStop(clamped);
        updateMediaSessionPosition(clamped);
      } else {
        pendingStartRef.current = clamped;
      }
      setCurrentTimeIfVisible(clamped);
      // Parado también se notifica: así quien pinta la onda deja el cabezal donde se tocó.
      onTimeUpdate?.(clamped);
    },
    [scheduleHardStop, updateMediaSessionPosition, setCurrentTimeIfVisible, onTimeUpdate]
  );

  useImperativeHandle(ref, () => ({
    togglePlay,
    stopIfPlaying,
    seekTo,
    retry,
  }), [togglePlay, stopIfPlaying, seekTo, retry]);

  if (!previewUrl || hasError) {
    // Distingue «esta canción no tiene audio» de «no se ha podido cargar», que tiene arreglo
    // (reintentar desde el botón de play). `role="alert"` para que se anuncie al aparecer.
    return (
      <div
        role="alert"
        className={cn("rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive", className)}
      >
        {previewUrl ? t("audioLoadError") : t("noAudio")}
      </div>
    );
  }

  const progress = Math.min((currentTime / maxDuration) * 100, 100);
  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  if (hideControls) {
    return null;
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
      <m.button
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
        {/* `key` por estado: evita que React mute el texto del nodo en sitio, que en iOS Safari
            deja el glifo anterior pintado debajo. Ver GameAudioSection.tsx. */}
        {isLoaded ? (
          <span
            aria-hidden
            key={isPlaying ? "stop" : "play"}
            className="material-symbols-outlined text-3xl text-primary-foreground"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {isPlaying ? "stop" : "play_arrow"}
          </span>
        ) : (
          <span aria-hidden key="loading" className="material-symbols-outlined animate-spin text-2xl text-muted-foreground">
            progress_activity
          </span>
        )}
      </m.button>
    </div>
  );
};

/**
 * `memo` para que un re-render del padre no arrastre al reproductor: monta el <audio> y sus
 * props son estables mientras dura la partida.
 */
export const AudioPlayer = memo(forwardRef(AudioPlayerComponent));
