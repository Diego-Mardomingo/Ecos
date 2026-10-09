"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, m, useReducedMotionConfig } from "framer-motion";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/audio-player/AudioPlayer";
import {
  SegmentedWaveform,
  type SegmentedWaveformHandle,
} from "@/components/game/SegmentedWaveform";
import { PlayButton } from "@/components/game/PlayButton";
import { ReportSongDialog, ReportSongTrigger } from "@/components/game/ReportSongDialog";
import { useLoginHref } from "@/components/game/useLoginHref";
import { Link } from "@/i18n/navigation";
import { useIsVirtualKeyboardOpen } from "@/lib/hooks/useVirtualKeyboard";
import type { GameWithSong } from "@/lib/queries/games";
import type { GuessEntry } from "@/lib/store/gameStore";
import { cn } from "@/lib/utils";

/**
 * Sección de audio de una partida en curso: la onda segmentada (que hace a la vez de franja de
 * intentos y de barra de progreso), el botón de play y, debajo, el buscador y los intentos.
 *
 * El progreso NO pasa por estado de React: se escribe en el DOM desde `handleAudioTimeUpdate`
 * porque `onTimeUpdate` llega en cada requestAnimationFrame. Ver el comentario de esa función.
 */

/** Lado del botón de play en px, normal y con el teclado abierto. */
const PLAY_BUTTON_PX = 84;
const PLAY_BUTTON_KEYBOARD_SCALE = 0.62;

/**
 * Duración de los ajustes de la pantalla al abrirse el teclado. Corta y con salida suave: lo que
 * se busca es que el cambio acompañe a la animación del teclado, no que se note como una
 * animación propia. `prefers-reduced-motion` la anula desde `globals.css`.
 *
 * Por qué compactar: en iOS el teclado no encoge el viewport de diseño, solo tapa la mitad
 * inferior, y Safari desplaza el documento para dejar a la vista el campo enfocado. Ese
 * desplazamiento es el tirón que se nota al tocar el buscador, y no se puede desactivar. Lo que sí
 * se puede es quitarle el motivo: si con el teclado abierto la pantalla cabe en la franja visible,
 * no hay nada que revelar y Safari no desplaza nada.
 */
const KEYBOARD_TRANSITION = "duration-[250ms] ease-out";

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

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
  /** Con el teclado abierto la pantalla se compacta. Ver `KEYBOARD_TRANSITION`. */
  const keyboardOpen = useIsVirtualKeyboardOpen();
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioLoaded, setAudioLoaded] = useState(false);
  /** La carga del audio ha fallado (red, proxy caído…): el botón de play pasa a reintentar. */
  const [audioFailed, setAudioFailed] = useState(false);
  /** El resolvedor dice que la partida no tiene audio (además de `!song.preview_url`). */
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const loginHref = useLoginHref();
  /** Segundo completo transcurrido. Cuantizado a propósito: ver `handleAudioTimeUpdate`. */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const waveformRef = useRef<SegmentedWaveformHandle | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** Lo que diga `MotionConfig` (`prefers-reduced-motion`): la sacudida es de transformación. */
  const reduceMotion = useReducedMotionConfig();
  const song = game.ecos_songs;
  const currentAttempt = Math.min(guesses.length + 1, maxAttempts);
  const noAudio = !song.preview_url || audioUnavailable;

  /**
   * `onTimeUpdate` llega en cada requestAnimationFrame. Guardarlo en estado re-renderizaría toda
   * esta sección ~60 veces por segundo mientras suena el fragmento.
   *
   * El progreso continuo se escribe directamente en el DOM de la onda, que es quien lo pinta, y el
   * estado solo cambia cuando cambia el segundo que se muestra en el reloj.
   */
  const handleAudioTimeUpdate = useCallback((currentTime: number) => {
    waveformRef.current?.setTime(currentTime);
    const whole = Math.floor(currentTime);
    setElapsedSeconds((prev) => (prev === whole ? prev : whole));
  }, []);

  /**
   * Sacudida de la tarjeta al fallar o saltar: el intento nuevo se ve en la lista, pero el
   * gesto dice "no" sin tener que leerla. Va en un efecto porque reacciona a un cambio de datos
   * (llega un intento), no a un evento de esta sección.
   *
   * Con la Web Animations API y no con el `useAnimate` de framer-motion, que arrastraba todo su
   * motor de animación a la carga inicial de la partida (PERF-07). Mismos fotogramas y la misma
   * curva `easeOut` de framer en cada tramo.
   */
  const lastGuessCountRef = useRef(guesses.length);
  useEffect(() => {
    const previous = lastGuessCountRef.current;
    lastGuessCountRef.current = guesses.length;
    if (guesses.length <= previous) return;
    const last = guesses[guesses.length - 1];
    const card = cardRef.current;
    if (!last || last.correct || !card || reduceMotion) return;
    card.animate(
      [0, -10, 9, -6, 4, -2, 0].map((x) => ({
        transform: `translateX(${x}px)`,
        easing: "cubic-bezier(0, 0, 0.58, 1)",
      })),
      { duration: 450 }
    );
  }, [guesses, reduceMotion]);

  return (
    <div
      className={cn(
        "flex flex-col px-4 transition-[padding]",
        KEYBOARD_TRANSITION,
        keyboardOpen ? "gap-2 pt-1" : "gap-4 pt-3"
      )}
    >
      {isGuest && (
        // Entrada en CSS: con framer, el aviso (el LCP de `/play` para invitados) llegaba con
        // `opacity:0` en el HTML del servidor y no se veía hasta hidratar (PERF-04).
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-2xl border border-brand/25 bg-brand/8 px-3 transition-[padding]",
            "animate-in fade-in slide-in-from-top-[6px] animation-duration-300",
            KEYBOARD_TRANSITION,
            // Se aprieta, no se oculta: es información que el invitado sigue necesitando mientras
            // escribe, y hacerla desaparecer sería justo el salto que se intenta evitar.
            keyboardOpen ? "py-1" : "py-2"
          )}
        >
          <span aria-hidden className="material-symbols-outlined text-lg text-brand" style={{ fontVariationSettings: "'FILL' 1" }}>
            person
          </span>
          <p className="flex-1 text-xs leading-snug text-foreground/80">{t("guestNotice")}</p>
          {/* Vuelve a esta partida al entrar (UX-01). El pseudo-elemento amplía la zona táctil
              a 44 px sin cambiar el aspecto del botón, que mide 24 de alto (UX-12). */}
          <Link
            href={loginHref}
            className="relative shrink-0 rounded-full bg-brand px-3 py-1 text-xs font-bold text-primary-foreground transition-transform before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] active:scale-95"
          >
            {tc("enter")}
          </Link>
        </div>
      )}

      {/* Tarjeta de la onda */}
      <div
        ref={cardRef}
        className={cn(
          "relative overflow-hidden rounded-3xl border border-border bg-card transition-[padding]",
          KEYBOARD_TRANSITION,
          keyboardOpen ? "px-3.5 py-2.5" : "p-4"
        )}
      >
        {/* Resplandor de fondo mientras suena. Opacidad, no filtro: no cuesta nada animarlo. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 transition-opacity duration-700",
            audioPlaying ? "opacity-100" : "opacity-0"
          )}
          style={{
            background:
              "radial-gradient(90% 70% at 50% 60%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 70%)",
          }}
        />

        <div className={cn("relative mb-3 flex items-center justify-between gap-2", keyboardOpen && "mb-2")}>
          <p className="text-sm font-semibold" aria-live="polite">
            {t("attemptOfMax", { attempt: currentAttempt, max: maxAttempts })}
          </p>
          <AnimatePresence mode="popLayout" initial={false}>
            <m.span
              key={audioDuration}
              initial={{ scale: 0.6, opacity: 0, y: 6 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.6, opacity: 0, y: -6 }}
              transition={{ type: "spring", stiffness: 500, damping: 28 }}
              className="inline-flex items-center gap-1 rounded-full bg-brand/12 px-2.5 py-1 text-xs font-bold tabular-nums text-brand ring-1 ring-brand/25"
            >
              <span aria-hidden className="material-symbols-outlined text-sm">graphic_eq</span>
              {t("fragmentSeconds", { seconds: audioDuration })}
            </m.span>
          </AnimatePresence>
        </div>

        <SegmentedWaveform
          ref={waveformRef}
          seed={game.id}
          unlockedCount={currentAttempt}
          guesses={guesses}
          currentAttempt={currentAttempt}
          playing={audioPlaying}
          compact={keyboardOpen}
          showLabels={!keyboardOpen}
          onSeek={audioLoaded ? (seconds) => playerRef.current?.seekTo(seconds) : undefined}
          seekLabel={t("seekLabel")}
          valueSeconds={elapsedSeconds}
          className="relative"
        />
      </div>

      {/* Reloj + botón de play */}
      <div
        className={cn(
          "flex items-center justify-center gap-6 transition-[height]",
          KEYBOARD_TRANSITION
        )}
        style={{ height: keyboardOpen ? PLAY_BUTTON_PX * PLAY_BUTTON_KEYBOARD_SCALE : PLAY_BUTTON_PX + 8 }}
      >
        <span className="w-12 text-right text-sm font-semibold tabular-nums text-foreground" aria-hidden>
          {formatClock(Math.min(elapsedSeconds, audioDuration))}
        </span>
        <div
          className={cn("transition-transform", KEYBOARD_TRANSITION)}
          style={{ transform: `scale(${keyboardOpen ? PLAY_BUTTON_KEYBOARD_SCALE : 1})` }}
        >
          <PlayButton
            playing={audioPlaying}
            loaded={audioLoaded}
            onClick={() => playerRef.current?.togglePlay()}
            size={PLAY_BUTTON_PX}
            labels={{
              play: t("playFragment"),
              stop: t("stopFragment"),
              loading: t("loadingAudio"),
              retry: t("retryAudio"),
              unavailable: t("noAudio"),
            }}
            failed={audioFailed}
            unavailable={noAudio}
            onRetry={() => playerRef.current?.retry()}
          />
        </div>
        <span className="w-12 text-sm font-medium tabular-nums text-muted-foreground" aria-hidden>
          {formatClock(audioDuration)}
        </span>
      </div>

      <div className={cn("transition-[padding]", KEYBOARD_TRANSITION, keyboardOpen ? "pb-3" : "pb-8")}>
        <AudioPlayer
          ref={playerRef}
          gameId={song.preview_url ? game.id : undefined}
          maxDuration={audioDuration}
          onTimeUpdate={handleAudioTimeUpdate}
          onPlayingChange={setAudioPlaying}
          onLoadedChange={setAudioLoaded}
          onErrorChange={setAudioFailed}
          onUnavailableChange={setAudioUnavailable}
          hideControls
        />
        {/* Sin audio la partida es a ciegas: quien tiene sesión puede avisar ya, sin esperar al
            resultado (UX-06). */}
        {!isGuest && (audioFailed || noAudio) && (
          <div className="mt-1 flex justify-center">
            <ReportSongDialog gameId={game.id} songId={song.id} trigger={<ReportSongTrigger />} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
});

export { PlayingGameAudioSection };
