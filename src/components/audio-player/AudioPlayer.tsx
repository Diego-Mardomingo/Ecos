"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle, memo } from "react";
import { useTranslations } from "next-intl";
import { m } from "framer-motion";
import { cn } from "@/lib/utils";
import { gameAudioLabel } from "@/lib/audio/audioStore";
import { FragmentPlayer, type FragmentPlayerContext } from "@/lib/audio/fragmentPlayer";
import { useGameAudio } from "@/lib/audio/useGameAudio";

export interface AudioPlayerHandle {
  togglePlay: () => void;
  /** Si está reproduciendo, pausa y resetea el fragmento (mismo efecto que pulsar Stop). */
  stopIfPlaying: () => void;
  /**
   * Lleva el cabezal a ese segundo, sin reproducir ni parar. Sonando, salta y sigue; parado, el
   * siguiente play arranca desde ahí. Se acota al fragmento disponible (`maxDuration`).
   */
  seekTo: (seconds: number) => void;
  /** Vuelve a resolver y descargar el audio después de un fallo de carga (UX-06). */
  retry: () => void;
}

interface AudioPlayerProps {
  /**
   * Partida cuyo audio suena. El MP3 lo resuelve y lo guarda `audioStore` (descarga directa del
   * CDN, una vez por partida). Sin `gameId` la canción no tiene audio.
   */
  gameId?: string;
  maxDuration: number;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  /** `true` solo cuando el cabezal avanza de verdad, no cuando se pide el play. */
  onPlayingChange?: (isPlaying: boolean) => void;
  /** Entre el toque y el primer avance del cabezal (en iOS, hasta ~0,4 s). */
  onStartingChange?: (isStarting: boolean) => void;
  onLoadedChange?: (isLoaded: boolean) => void;
  /** Avisa cuando la carga del audio falla (red, resolvedor caído…) y cuando deja de estar fallida. */
  onErrorChange?: (failed: boolean) => void;
  /** La partida no tiene audio (no hay `gameId` o el resolvedor dice que no existe). */
  onUnavailableChange?: (unavailable: boolean) => void;
  /** Cuando true, no se muestra la barra ni el botón (el padre dibuja el control grande) */
  hideControls?: boolean;
  className?: string;
}

const AudioPlayerComponent = ({
  gameId,
  maxDuration,
  onEnded,
  onTimeUpdate,
  onPlayingChange,
  onStartingChange,
  onLoadedChange,
  onErrorChange,
  onUnavailableChange,
  hideControls = false,
  className,
}: AudioPlayerProps,
ref: React.Ref<AudioPlayerHandle>) => {
  const t = useTranslations("game");
  const fragmentTitle = t("audioFragment");
  const { audio: stored, retry: retryStore } = useGameAudio(gameId);
  // El Blob (o, sin él, la URL directa) cuando la caché del audio ya lo tiene.
  const src = stored.status === "ready" ? (stored.blobUrl ?? stored.directUrl) : null;
  const unavailable = !gameId || stored.status === "unavailable";

  const playerRef = useRef<FragmentPlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  /** El `<audio>` ha dado error (decodificación, URL directa caída…). El de la caché va aparte. */
  const [elementError, setElementError] = useState(false);
  const failed = !unavailable && (stored.status === "error" || elementError);
  /**
   * Solo alimenta los controles propios del reproductor. Con `hideControls` no se pinta, y el
   * bucle de progreso corre a 60 fps, así que ahí no se toca: quien dibuja es el padre a través
   * de `onTimeUpdate`.
   */
  const [currentTime, setCurrentTime] = useState(0);
  /**
   * Se incrementa en cada reintento: el efecto que crea el motor depende de él, así que un
   * reintento monta un `<audio>` nuevo aunque la URL sea la misma (la directa).
   */
  const [loadAttempt, setLoadAttempt] = useState(0);

  const handleTimeUpdate = (time: number) => {
    if (!hideControls) setCurrentTime(time);
    onTimeUpdate?.(time);
  };

  // Lo vigente (duración del fragmento, callbacks) para el motor, que lo lee cuando lo necesita
  // en vez de recrearse. Se escribe tras el commit y no durante el render, que rompe las
  // garantías del compilador de React. Va antes del efecto que crea el motor: así, en un mismo
  // commit, ya está al día cuando este arranca.
  const latestRef = useRef<FragmentPlayerContext>({
    maxDuration,
    fragmentTitle,
    onTimeUpdate: handleTimeUpdate,
    onEnded,
  });
  useEffect(() => {
    latestRef.current = { maxDuration, fragmentTitle, onTimeUpdate: handleTimeUpdate, onEnded };
  });

  // Reset al cambiar de audio (otra partida, un Blob nuevo, un reintento), ajustando el estado
  // durante el render en lugar de en el efecto. En el primer render no hace nada, porque estos son
  // ya los valores iniciales.
  const mediaKey = src ? `${src}|${loadAttempt}` : "";
  const [lastMediaKey, setLastMediaKey] = useState(mediaKey);
  if (mediaKey !== lastMediaKey) {
    setLastMediaKey(mediaKey);
    setIsLoaded(false);
    setElementError(false);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsStarting(false);
  }

  useEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);

  useEffect(() => {
    onStartingChange?.(isStarting);
  }, [isStarting, onStartingChange]);

  useEffect(() => {
    onLoadedChange?.(isLoaded);
  }, [isLoaded, onLoadedChange]);

  useEffect(() => {
    onErrorChange?.(failed);
  }, [failed, onErrorChange]);

  useEffect(() => {
    onUnavailableChange?.(unavailable);
  }, [unavailable, onUnavailableChange]);

  useEffect(() => {
    if (!src || !gameId) return;
    const player = new FragmentPlayer(src, gameAudioLabel(gameId), () => latestRef.current, {
      loadedChange: setIsLoaded,
      startingChange: setIsStarting,
      playingChange: setIsPlaying,
      error: () => setElementError(true),
    });
    playerRef.current = player;
    return () => {
      player.dispose();
      playerRef.current = null;
    };
    // `loadAttempt` no se lee dentro: está para que un reintento vuelva a crear el `<audio>`.
  }, [src, gameId, loadAttempt]);

  const retry = useCallback(() => {
    if (!gameId) return;
    setLoadAttempt((n) => n + 1);
    retryStore();
  }, [gameId, retryStore]);

  const togglePlay = useCallback(() => {
    playerRef.current?.toggle();
  }, []);

  useImperativeHandle(ref, () => ({
    togglePlay,
    stopIfPlaying: () => playerRef.current?.stopIfPlaying(),
    seekTo: (seconds: number) => playerRef.current?.seekTo(seconds),
    retry,
  }), [togglePlay, retry]);

  // Con `hideControls` el padre pinta el botón y sus estados (reintentar, sin audio): una alerta
  // propia aquí saldría además encima de ellos.
  if (hideControls) {
    return null;
  }

  if (unavailable || failed) {
    // Distingue «esta canción no tiene audio» de «no se ha podido cargar», que tiene arreglo
    // (reintentar desde el botón de play). `role="alert"` para que se anuncie al aparecer.
    return (
      <div
        role="alert"
        className={cn("rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive", className)}
      >
        {unavailable ? t("noAudio") : t("audioLoadError")}
      </div>
    );
  }

  const progress = Math.min((currentTime / maxDuration) * 100, 100);
  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

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
