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
import { AttemptsStrip } from "@/components/game/AttemptsStrip";
import { Link } from "@/i18n/navigation";
import { useIsVirtualKeyboardOpen } from "@/lib/hooks/useVirtualKeyboard";
import type { GameWithSong } from "@/lib/queries/games";
import type { GuessEntry } from "@/lib/store/gameStore";
import { cn } from "@/lib/utils";

/**
 * Sección de audio de una partida en curso: cuenta atrás, franja de intentos, anillo de
 * progreso, botón grande y puntos de intento. Extraído de `GameClient` sin cambios de lógica.
 *
 * El progreso NO pasa por estado de React: se escribe en el DOM desde `handleAudioTimeUpdate`
 * porque `onTimeUpdate` llega en cada requestAnimationFrame. Ver el comentario de esa función.
 */

/** Perímetro del anillo de progreso (2πr con r=80), para el dash del SVG. */
const RING_CIRCUMFERENCE = 502.65;

/** Lado del anillo de progreso en px. Coincide con el `viewBox` del SVG. */
const RING_SIZE_PX = 192;

/**
 * Escala del anillo mientras el teclado está abierto.
 *
 * En iOS el teclado no encoge el viewport de diseño: solo tapa la mitad inferior de la pantalla,
 * y Safari desplaza el documento para dejar a la vista el campo enfocado. Ese desplazamiento es
 * el tirón que se nota al tocar el buscador, y no se puede desactivar —`interactive-widget` y la
 * VirtualKeyboard API siguen sin implementarse en WebKit—. Lo que sí se puede es quitarle el
 * motivo: si con el teclado abierto la pantalla cabe en la franja visible, no hay nada que
 * revelar y Safari no desplaza nada.
 *
 * Entre esta escala y los paddings recortados se ganan unos 155 px, que es de sobra lo que hace
 * falta en un iPhone con notch (~120 px) y casi todo lo que hace falta en un SE.
 */
const RING_KEYBOARD_SCALE = 0.56;

/**
 * Duración de los ajustes de la pantalla al abrirse el teclado. Corta y con salida suave: lo que
 * se busca es que el cambio acompañe a la animación del teclado, no que se note como una
 * animación propia. `prefers-reduced-motion` la anula desde `globals.css`.
 */
const KEYBOARD_TRANSITION = "duration-[250ms] ease-out";

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
  /** Con el teclado abierto la pantalla se compacta. Ver `RING_KEYBOARD_SCALE`. */
  const keyboardOpen = useIsVirtualKeyboardOpen();
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioLoaded, setAudioLoaded] = useState(false);
  /** Segundo completo transcurrido. Cuantizado a propósito: ver `handleAudioTimeUpdate`. */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const ringRef = useRef<SVGCircleElement | null>(null);
  const song = game.ecos_songs;

  /**
   * `onTimeUpdate` llega en cada requestAnimationFrame. Guardarlo en estado re-renderizaba toda
   * esta sección ~60 veces por segundo mientras suena el fragmento: el anillo SVG de 192 px, el
   * botón de framer-motion y los puntos de intento.
   *
   * El progreso continuo se escribe directamente en el DOM del anillo, que es quien lo pinta, y
   * el estado solo cambia cuando cambia el segundo que se muestra en el contador (una vez por
   * segundo en vez de sesenta).
   */
  const handleAudioTimeUpdate = useCallback(
    (currentTime: number) => {
      const ratio =
        audioDuration > 0 ? Math.min(currentTime / audioDuration, 1) : 0;

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
      <div
        className={cn(
          "flex w-full flex-col items-center px-4 pt-1 transition-[padding]",
          KEYBOARD_TRANSITION,
          keyboardOpen ? "pb-1" : "pb-4"
        )}
      >
        <span
          className={cn(
            "font-bold tracking-tight tabular-nums text-foreground transition-[font-size,line-height]",
            KEYBOARD_TRANSITION,
            keyboardOpen ? "text-xl" : "text-3xl"
          )}
        >
          {formatTimeRemaining(secondsRemaining)}
        </span>
        <AttemptsStrip
          className="mt-2"
          guesses={guesses}
          maxAttempts={maxAttempts}
          currentAttempt={guesses.length + 1}
          audioDuration={audioDuration}
        />
      </div>

      {isGuest && (
        <div
          className={cn(
            "mx-4 flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 px-3 transition-[padding,margin]",
            KEYBOARD_TRANSITION,
            // Se aprieta, no se oculta: es información que el invitado sigue necesitando mientras
            // escribe, y hacerla desaparecer sería justo el salto que se intenta evitar.
            keyboardOpen ? "mt-1 py-1" : "mt-2 py-2"
          )}
        >
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

      <div
        className={cn(
          "relative flex shrink-0 flex-col items-center justify-start gap-3 overflow-hidden px-4 transition-[padding]",
          KEYBOARD_TRANSITION,
          keyboardOpen ? "pb-0 pt-1" : "pb-2 pt-4"
        )}
      >
        {/* El anillo se encoge en dos capas que se animan a la vez: el hueco que ocupa (la altura
            de este contenedor) y el dibujo (un `scale` sobre el de dentro). Escalar en lugar de
            redimensionar el SVG evita recalcular el layout del botón y del glifo en cada frame, y
            `origin-top` hace que encoja hacia arriba, que es de donde hay que sacar el sitio. */}
        <div
          className={cn("relative shrink-0 transition-[height]", KEYBOARD_TRANSITION)}
          style={{
            height: keyboardOpen
              ? RING_SIZE_PX * RING_KEYBOARD_SCALE
              : RING_SIZE_PX,
          }}
        >
          <div
            className={cn(
              "relative flex origin-top items-center justify-center transition-transform",
              KEYBOARD_TRANSITION
            )}
            style={{
              width: RING_SIZE_PX,
              height: RING_SIZE_PX,
              transform: `scale(${keyboardOpen ? RING_KEYBOARD_SCALE : 1})`,
            }}
          >
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
              {/* El `key` no es decorativo. Sin él React reutiliza el mismo <span> y solo cambia
                  el texto del nodo. En iOS Safari este botón acaba en una capa de composición
                  —solapa el anillo SVG, cuyo strokeDashoffset se reescribe en cada frame, y
                  framer-motion le escribe transform— y WebKit no invalida esa capa ante un cambio
                  que es solo de texto: el glifo anterior se queda rasterizado debajo del nuevo y se
                  ven play y stop a la vez, de forma fija. Con un `key` distinto por estado React
                  sustituye el nodo, y un cambio estructural del DOM sí fuerza el repintado. */}
              {audioLoaded ? (
                <span aria-hidden
                  key={audioPlaying ? "stop" : "play"}
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
                  key="loading"
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
      </div>

      <div
        className={cn(
          "px-4 transition-[padding]",
          KEYBOARD_TRANSITION,
          keyboardOpen ? "pb-3 pt-2" : "pb-8 pt-5"
        )}
      >
        <AudioPlayer
          ref={playerRef}
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
