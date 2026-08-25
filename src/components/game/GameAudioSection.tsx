"use client";

import {
  memo,
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/audio-player/AudioPlayer";
import { Link } from "@/i18n/navigation";
import type { GameWithSong } from "@/lib/queries/games";
import type { GuessEntry } from "@/lib/store/gameStore";
import { cn } from "@/lib/utils";

/**
 * Sección de audio de una partida en curso: cuenta atrás, anillo de progreso, botón grande y
 * puntos de intento. Extraído de `GameClient` sin cambios de lógica.
 *
 * El progreso NO pasa por estado de React: se escribe en el DOM desde `handleAudioTimeUpdate`
 * porque `onTimeUpdate` llega en cada requestAnimationFrame. Ver el comentario de esa función.
 */

/** Perímetro del anillo de progreso (2πr con r=80), para el dash del SVG. */
const RING_CIRCUMFERENCE = 502.65;

const PlayingGameAudioSection = memo(function PlayingGameAudioSection({
  game,
  audioDuration,
  guesses,
  maxAttempts,
  isGuest,
  playerRef,
  children,
}: {
  game: GameWithSong;
  audioDuration: number;
  guesses: GuessEntry[];
  maxAttempts: number;
  isGuest: boolean;
  playerRef: RefObject<AudioPlayerHandle | null>;
  children: ReactNode;
}) {
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioLoaded, setAudioLoaded] = useState(false);
  /** Segundo completo transcurrido. Cuantizado a propósito: ver `handleAudioTimeUpdate`. */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<SVGCircleElement | null>(null);
  const song = game.ecos_songs;

  /**
   * `onTimeUpdate` llega en cada requestAnimationFrame. Guardarlo en estado re-renderizaba toda
   * esta sección ~60 veces por segundo mientras suena el fragmento: el anillo SVG de 192 px, el
   * botón de framer-motion y los puntos de intento.
   *
   * El progreso continuo se escribe directamente en el DOM de los dos nodos que lo pintan, y el
   * estado solo cambia cuando cambia el segundo que se muestra en el contador (una vez por
   * segundo en vez de sesenta).
   */
  const handleAudioTimeUpdate = useCallback(
    (currentTime: number) => {
      const ratio =
        audioDuration > 0 ? Math.min(currentTime / audioDuration, 1) : 0;

      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${ratio * 100}%`;
      }
      if (ringRef.current) {
        ringRef.current.style.strokeDashoffset = String(
          RING_CIRCUMFERENCE * (1 - ratio)
        );
      }

      const whole = Math.floor(currentTime);
      setElapsedSeconds((prev) => (prev === whole ? prev : whole));
    },
    [audioDuration]
  );

  // Derivado en render: si cambia la duración del intento, el contador se ajusta solo.
  const secondsRemaining = Math.max(0, audioDuration - elapsedSeconds);

  const formatTimeRemaining = (s: number) => {
    if (s <= 0) return "00:00";
    const secs = Math.ceil(s);
    return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  };

  return (
    <>
      <div className="flex w-full flex-col items-center px-4 pb-4 pt-1">
        <span className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
          {formatTimeRemaining(secondsRemaining)}
        </span>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          {/* El ancho lo escribe handleAudioTimeUpdate; aquí solo el valor de partida. */}
          <div
            ref={progressBarRef}
            className="h-full rounded-full bg-brand"
            style={{ width: "0%" }}
          />
        </div>
      </div>

      {isGuest && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 px-3 py-2">
          <span aria-hidden
            className="material-symbols-outlined text-base text-brand"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            info
          </span>
          <p className="flex-1 text-xs text-brand/90">{t("guestNotice")}</p>
          <Link href="/login" className="text-xs font-bold text-brand underline underline-offset-2">
            {tc("enter")}
          </Link>
        </div>
      )}

      <div className="relative flex shrink-0 flex-col items-center justify-start gap-3 overflow-hidden px-4 pb-2 pt-4">
        <div className="relative flex flex-col items-center gap-2">
          <div className="relative flex items-center justify-center">
            <svg className="h-48 w-48 -rotate-90" viewBox="0 0 192 192" aria-hidden>
              <circle
                cx="96"
                cy="96"
                r="80"
                fill="transparent"
                stroke="currentColor"
                strokeWidth="6"
                className="text-muted dark:text-white/5"
              />
              {/* strokeDashoffset lo escribe handleAudioTimeUpdate; aquí el valor de partida. */}
              <circle
                ref={ringRef}
                cx="96"
                cy="96"
                r="80"
                fill="transparent"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                className="text-brand"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE}
              />
            </svg>
            <motion.button
              type="button"
              onClick={() => playerRef.current?.togglePlay()}
              whileTap={{ scale: 0.95 }}
              whileHover={{ scale: audioLoaded ? 1.05 : 1 }}
              disabled={!audioLoaded}
              className={cn(
                "absolute flex size-32 items-center justify-center rounded-full shadow-lg transition-transform",
                audioLoaded
                  ? "bg-brand text-primary-foreground shadow-brand/20 hover:scale-105 active:scale-95"
                  : "cursor-not-allowed bg-muted text-muted-foreground opacity-50"
              )}
              aria-label={audioPlaying ? t("listening") : t("pressPlay")}
            >
              {audioLoaded ? (
                <span aria-hidden
                  className="material-symbols-outlined inline-block font-bold"
                  style={{
                    fontVariationSettings: "'FILL' 1, 'opsz' 48",
                    fontSize: "3.25rem",
                  }}
                >
                  {audioPlaying ? "stop" : "play_arrow"}
                </span>
              ) : (
                <span aria-hidden
                  className="material-symbols-outlined inline-block animate-spin"
                  style={{
                    fontVariationSettings: "'opsz' 48",
                    fontSize: "2.75rem",
                  }}
                >
                  progress_activity
                </span>
              )}
            </motion.button>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {Array.from({ length: maxAttempts }).map((_, i) => {
            const guess = guesses[i];
            const isCurrent = i === guesses.length;
            return (
              <div
                key={i}
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                aria-hidden
              >
                <div
                  className={cn(
                    "h-2.5 w-2.5 rounded-full transition-all",
                    i < guesses.length
                      ? guess?.correct
                        ? "bg-brand"
                        : "bg-destructive"
                      : isCurrent
                        ? "bg-brand/50 ring-2 ring-brand/30"
                        : "bg-muted"
                  )}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 pb-8 pt-5">
        <AudioPlayer
          ref={playerRef}
          youtubeId={song.youtube_id ?? ""}
          previewUrl={song.preview_url ? `/api/audio-proxy?gameId=${game.id}` : undefined}
          maxDuration={audioDuration}
          onTimeUpdate={handleAudioTimeUpdate}
          onPlayingChange={setAudioPlaying}
          onLoadedChange={setAudioLoaded}
          hideControls
          className="mb-3"
        />
        {children}
      </div>
    </>
  );
});

export { PlayingGameAudioSection };
