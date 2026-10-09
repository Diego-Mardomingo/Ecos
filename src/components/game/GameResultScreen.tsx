"use client";

import { memo, useCallback, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format, parseISO } from "date-fns";
import { AnimatePresence, m } from "framer-motion";
import Image from "next/image";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/audio-player/AudioPlayer";
import { Link } from "@/i18n/navigation";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { localizedPath } from "@/lib/i18n/localizedPath";
import { useNavigateBackToHome } from "@/lib/navigation/useNavigateBackToHome";
import type { GameWithSong } from "@/lib/queries/games";
import { MAX_ATTEMPTS } from "@/lib/server-attempt";
import { releaseYearFromReleaseDate } from "@/lib/song-display";
import type { GamePhase, GuessEntry } from "@/lib/store/gameStore";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { PreviousAttempts } from "@/components/game/GameAttemptsList";
import { GameBackdrop } from "@/components/game/GameBackdrop";
import { GameHeader } from "@/components/game/GameHeader";
import { PlayButton } from "@/components/game/PlayButton";
import { ReportSongDialog, ReportSongTrigger } from "@/components/game/ReportSongDialog";
import { useLoginHref } from "@/components/game/useLoginHref";
import { NotificationsModal } from "@/components/notifications/NotificationsModal";
import {
  SegmentedWaveform,
  type SegmentedWaveformHandle,
} from "@/components/game/SegmentedWaveform";

/**
 * Pantalla de resultado: la canción revelada, la puntuación, compartir y el formulario de
 * reporte. `ResultGameView` es el contenedor de pantalla completa (fondo, cabecera y audio) y
 * `ResultScreen` el cuerpo.
 *
 * La revelación va por pasos: la carátula se enfoca, un vinilo asoma por detrás y gira mientras
 * suena, y después entran el título, la onda, los puntos (contando) y las acciones.
 */

/** Duración máxima del preview en pantalla de resultado (segundos completos) */
const FULL_PREVIEW_SECONDS = 30;
/** En el resultado la onda se ve entera: un tramo por intento. */
const ALL_SEGMENTS = MAX_ATTEMPTS;

/**
 * La revelación va en CSS y no en framer-motion: con framer, una partida ya terminada llegaba en
 * el HTML del servidor con la carátula y todo el resultado a `opacity:0`, y no se veía hasta
 * hidratar (PERF-04). Las animaciones CSS corren desde el primer pintado. Mismos tiempos y curvas
 * que tenían; los muelles se imitan con una curva con rebote. `prefers-reduced-motion` las anula
 * desde `globals.css`.
 */
const EASE_OUT = "[--tw-ease:cubic-bezier(0.22,1,0.36,1)]";
const EASE_SPRING = "[--tw-ease:cubic-bezier(0.34,1.56,0.64,1)]";

/** Cada bloque sube después del anterior (el antiguo `staggerChildren` de 0,08 s tras 0,45 s). */
const RISE = cn("animate-in fade-in slide-in-from-bottom-4 animation-duration-500 fill-mode-backwards", EASE_OUT);
const riseDelay = (step: number) => ({ animationDelay: `${450 + step * 80}ms` });

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Lo que el reproductor usa para llevar el progreso a la onda y al reloj de la pantalla. */
type ResultWaveformHandle = {
  /** Segundos reproducidos del fragmento. */
  setTime: (seconds: number) => void;
};

/**
 * Onda del resultado con su reloj. El segundo transcurrido vive **aquí** y no en `ResultGameView`:
 * cambia una vez por segundo mientras suena, y arriba re-renderizaba la pantalla entera (carátula,
 * puntuación, acciones, lista de intentos) en cada tic. Ahora solo se repinta esta pieza.
 */
const ResultWaveform = memo(function ResultWaveform({
  seed,
  guesses,
  correctAttempt,
  playing,
  onSeek,
  ref,
}: {
  seed: string;
  guesses: GuessEntry[];
  correctAttempt: number | null;
  playing: boolean;
  onSeek?: (seconds: number) => void;
  ref?: Ref<ResultWaveformHandle>;
}) {
  const t = useTranslations("game");
  /** Segundo completo transcurrido: el reloj solo cambia una vez por segundo. */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const waveformRef = useRef<SegmentedWaveformHandle | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      setTime: (seconds: number) => {
        waveformRef.current?.setTime(seconds);
        const whole = Math.floor(seconds);
        setElapsedSeconds((prev) => (prev === whole ? prev : whole));
      },
    }),
    []
  );

  return (
    <>
      <SegmentedWaveform
        ref={waveformRef}
        seed={seed}
        unlockedCount={ALL_SEGMENTS}
        guesses={guesses}
        correctAttempt={correctAttempt}
        playing={playing}
        onSeek={onSeek}
        seekLabel={t("seekLabel")}
        valueSeconds={elapsedSeconds}
      />
      <div className="mt-2 flex justify-between text-[11px] font-medium tabular-nums text-muted-foreground">
        <span>{formatClock(elapsedSeconds)}</span>
        <span>{formatClock(FULL_PREVIEW_SECONDS)}</span>
      </div>
    </>
  );
});

const ResultGameView = memo(function ResultGameView({
  game,
  resultPhase,
  resultCorrectAttempt,
  resultFinalScore,
  resultGuesses,
  isGuest,
  maxAttempts,
}: {
  game: GameWithSong;
  resultPhase: GamePhase;
  resultCorrectAttempt: number | null;
  resultFinalScore: number | null;
  resultGuesses: GuessEntry[];
  isGuest: boolean;
  maxAttempts: number;
}) {
  const [audioPlaying, setAudioPlaying] = useState(false);
  /** Entre el toque y el primer avance del cabezal: solo adelanta el icono del botón. */
  const [audioStarting, setAudioStarting] = useState(false);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  /** El resolvedor dice que la partida no tiene audio (además de `!song.preview_url`). */
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const resultAudioPlayerRef = useRef<AudioPlayerHandle | null>(null);
  const waveformRef = useRef<ResultWaveformHandle | null>(null);
  const song = game.ecos_songs;

  /**
   * Mismo motivo que en PlayingGameAudioSection: no re-renderizar esta pantalla a 60 fps. Tampoco
   * una vez por segundo: el reloj lo lleva `ResultWaveform`.
   */
  const handleAudioTimeUpdate = useCallback((currentTime: number) => {
    waveformRef.current?.setTime(currentTime);
  }, []);

  const handleAudioEnded = useCallback(() => {
    handleAudioTimeUpdate(0);
    setTimeout(() => handleAudioTimeUpdate(0), 150);
  }, [handleAudioTimeUpdate]);

  const togglePlay = useCallback(() => {
    resultAudioPlayerRef.current?.togglePlay();
  }, []);

  const seek = useCallback((seconds: number) => {
    resultAudioPlayerRef.current?.seekTo(seconds);
  }, []);

  const retryAudio = useCallback(() => {
    resultAudioPlayerRef.current?.retry();
  }, []);

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <GameBackdrop cover={song.cover_url} />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <GameHeader game={game} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ResultScreen
            phase={resultPhase as "won" | "lost"}
            song={song}
            gameId={game.id}
            gameDate={game.date}
            correctAttempt={resultCorrectAttempt}
            finalScore={resultFinalScore}
            maxAttempts={maxAttempts}
            gameNumber={game.game_number}
            isGuest={isGuest}
            guesses={resultGuesses}
            audio={{
              playing: audioPlaying,
              starting: audioStarting,
              loaded: audioLoaded,
              failed: audioFailed,
              unavailable: !song.preview_url || audioUnavailable,
              retry: retryAudio,
              toggle: togglePlay,
              seek,
            }}
            waveformRef={waveformRef}
          />
        </div>
      </div>
      <AudioPlayer
        ref={resultAudioPlayerRef}
        gameId={song.preview_url ? game.id : undefined}
        maxDuration={FULL_PREVIEW_SECONDS}
        onTimeUpdate={handleAudioTimeUpdate}
        onPlayingChange={setAudioPlaying}
        onStartingChange={setAudioStarting}
        onLoadedChange={setAudioLoaded}
        onErrorChange={setAudioFailed}
        onUnavailableChange={setAudioUnavailable}
        onEnded={handleAudioEnded}
        hideControls
      />
    </div>
  );
});

/**
 * Comparte con la hoja nativa y, si no la hay o falla (salvo que el usuario la cierre), copia el
 * texto al portapapeles. Devuelve `true` si lo copió. Va fuera del componente porque el React
 * Compiler no admite condicionales dentro de un `try` y dejaría sin compilar `ResultScreen` entero.
 */
async function shareOrCopy(
  data: { title: string; text: string; url: string },
  clipboardText: string
): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share(data);
      return false;
    }
    await navigator.clipboard.writeText(clipboardText);
    return true;
  } catch (err) {
    if ((err as Error).name === "AbortError") return false;
    try {
      await navigator.clipboard.writeText(clipboardText);
      return true;
    } catch {
      return false;
    }
  }
}

function ResultScreen({
  phase,
  song,
  gameId,
  gameDate,
  correctAttempt,
  finalScore,
  maxAttempts,
  gameNumber,
  isGuest,
  guesses = [],
  audio,
  waveformRef,
}: {
  phase: "won" | "lost";
  song: GameWithSong["ecos_songs"];
  gameId: string;
  gameDate: string;
  correctAttempt: number | null;
  finalScore: number | null;
  maxAttempts: number;
  gameNumber: number;
  isGuest: boolean;
  guesses?: GuessEntry[];
  audio: {
    playing: boolean;
    starting: boolean;
    loaded: boolean;
    failed: boolean;
    unavailable: boolean;
    retry: () => void;
    toggle: () => void;
    seek: (seconds: number) => void;
  };
  /**
   * Aparte de `audio` a propósito: dentro de ese objeto, el compilador de React trataría el
   * objeto entero como una ref y daría por prohibido leer cualquiera de sus campos al renderizar.
   */
  waveformRef: React.RefObject<ResultWaveformHandle | null>;
}) {
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { dateFnsLocale, formatNumber } = useAppFormatters();
  const won = phase === "won";
  const metaAlbum = song.album_title?.trim();
  const metaYear = releaseYearFromReleaseDate(song.release_date);
  const songMeta = [metaAlbum, metaYear].filter(Boolean) as string[];
  const [shareCopied, setShareCopied] = useState(false);
  const navigateBackToHome = useNavigateBackToHome();
  const loginHref = useLoginHref();

  const handleShare = async () => {
    const shareUrl =
      typeof window !== "undefined"
        ? // Sin prefijo en español (`localePrefix: "as-needed"`): con `/es/` costaba un 307 (SEO-06).
          `${window.location.origin}${localizedPath(locale, `/play/${gameId}`)}`
        : "";
    const title = won
      ? t("shareTitleWon", {
          attempt: correctAttempt ?? 0,
          max: maxAttempts,
          score: (finalScore ?? 0).toLocaleString(),
        })
      : t("shareTitleLost");
    const scoreText = won
      ? t("shareScoreWon", {
          attempt: correctAttempt ?? 0,
          max: maxAttempts,
          score: (finalScore ?? 0).toLocaleString(),
        })
      : t("shareScoreLost");
    const inviteText = t("shareInvite");
    const dateLabel = (() => {
      if (!gameDate) return "";
      try {
        return format(parseISO(String(gameDate)), "d MMM", { locale: dateFnsLocale }).toUpperCase();
      } catch {
        return "";
      }
    })();
    const metaLabel = dateLabel ? `${dateLabel} · #${gameNumber}` : `#${gameNumber}`;
    const correctIdx = won && correctAttempt != null ? correctAttempt - 1 : -1;
    const dotsEmoji = Array.from({ length: maxAttempts }, (_, i) => {
      if (won && correctAttempt != null) {
        if (i < correctIdx) return "🔴";
        if (i === correctIdx) return "🟢";
        return "⚪";
      }
      return "🔴";
    }).join("");
    const emojiIntro = won ? "🎵 🏆" : "🎵 💪";
    const textWithEmojis = `${emojiIntro} ${metaLabel}\n${scoreText}\n\n${dotsEmoji}\n\n👇 ${inviteText}`;
    const fullTextForClipboard = `${emojiIntro} ${metaLabel}\n${scoreText}\n\n${dotsEmoji}\n\n👇 ${inviteText} ${shareUrl}`;
    const copied = await shareOrCopy(
      { title, text: textWithEmojis, url: shareUrl },
      fullTextForClipboard
    );
    if (copied) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  };

  /** Turno de las acciones en el escalonado: el banner de invitado, si sale, va antes. */
  const actionsStep = isGuest ? 5 : 4;

  return (
    <div className="flex min-h-full flex-col items-center gap-6 px-5 pb-12 pt-6 text-center">
      {/* Carátula + vinilo. El grupo se desplaza a la izquierda a la vez que el vinilo asoma por la
          derecha, para que el conjunto siga centrado. */}
      <div
        className={cn(
          "relative size-[200px] shrink-0 -translate-x-[17%]",
          "animate-in slide-in-from-right-[17%] animation-duration-800 [--tw-animation-delay:550ms] fill-mode-backwards",
          EASE_OUT
        )}
      >
        <div
          aria-hidden
          className={cn(
            "absolute inset-[4%] translate-x-[36%] rounded-full shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)]",
            "animate-in fade-in slide-in-from-left-[36%] animation-duration-800 [--tw-animation-delay:550ms] fill-mode-backwards",
            EASE_OUT
          )}
        >
          <div
            className="ecos-vinyl ecos-spin-slow relative size-full rounded-full"
            style={{ animationPlayState: audio.playing ? "running" : "paused" }}
          >
            <div className="absolute inset-[33%] overflow-hidden rounded-full ring-2 ring-black/60">
              {song.cover_url ? (
                <Image src={song.cover_url} alt="" fill sizes="64px" className="object-cover" />
              ) : (
                <div className="size-full bg-brand" />
              )}
            </div>
            <div className="absolute inset-[47.5%] rounded-full bg-background" />
          </div>
        </div>

        <m.button
          type="button"
          onClick={audio.loaded ? audio.toggle : undefined}
          aria-label={audio.playing ? t("stopSong") : t("listenSong")}
          whileTap={{ scale: 0.97 }}
          className={cn(
            "group relative block size-full overflow-hidden rounded-2xl shadow-[0_24px_50px_-16px_rgba(0,0,0,0.75)] ring-1 ring-white/10",
            "animate-in fade-in zoom-in-82 spin-in-[-6deg] blur-in-14 animation-duration-700",
            EASE_OUT
          )}
        >
          {song.cover_url ? (
            <Image src={song.cover_url} alt={song.title} fill className="object-cover" sizes="200px" priority />
          ) : (
            <div className="size-full bg-gradient-to-br from-brand/30 to-card" />
          )}
          {/* Brillo diagonal que cruza la carátula una vez al revelarse. */}
          <span
            aria-hidden
            className="absolute inset-0 translate-x-[120%] animate-in bg-[linear-gradient(105deg,transparent_35%,rgba(255,255,255,0.35)_50%,transparent_65%)] slide-in-from-left-[240%] animation-duration-900 ease-in-out [--tw-animation-delay:600ms] fill-mode-backwards"
          />
        </m.button>

        <div className="absolute -bottom-4 -right-4 z-10">
          <PlayButton
            playing={audio.playing}
            starting={audio.starting}
            loaded={audio.loaded}
            onClick={audio.toggle}
            size={60}
            labels={{
              play: t("listenSong"),
              stop: t("stopSong"),
              loading: t("loadingAudio"),
              retry: t("retryAudio"),
              unavailable: t("noAudio"),
            }}
            failed={audio.failed}
            unavailable={audio.unavailable}
            onRetry={audio.retry}
          />
        </div>
      </div>

      {/* Veredicto + canción */}
      <div className={cn(RISE, "mt-2 flex w-full flex-col items-center gap-2")} style={riseDelay(0)}>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1",
            won ? "bg-brand/12 text-brand ring-brand/30" : "bg-destructive/10 text-destructive ring-destructive/30"
          )}
        >
          <span aria-hidden className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
            {won ? "celebration" : "heart_broken"}
          </span>
          {won ? t("wonTitle") : t("lostTitle")}
        </span>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t("revealingSong")}
        </p>
        <h2 className="text-balance text-[26px] font-bold leading-tight tracking-tight">{song.title}</h2>
        <p className="text-base text-muted-foreground">{song.artist_name}</p>
        {songMeta.length > 0 ? (
          <ul className="mt-1 flex flex-wrap justify-center gap-1.5" aria-label={[t("resultAlbum"), t("resultYear"), t("resultGenre")].join(", ")}>
            {songMeta.map((item, i) => (
              <li
                key={item}
                style={{ animationDelay: `${750 + i * 60}ms` }}
                className={cn(
                  "max-w-full truncate rounded-full border border-border bg-card/70 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur",
                  "animate-in fade-in zoom-in-80 animation-duration-400 fill-mode-backwards",
                  EASE_SPRING
                )}
              >
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Onda: la canción entera, con los tramos coloreados por cómo fue cada intento. */}
      <div className={cn(RISE, "w-full rounded-3xl border border-border bg-card/80 p-4 backdrop-blur")} style={riseDelay(1)}>
        <ResultWaveform
          ref={waveformRef}
          seed={gameId}
          guesses={guesses}
          correctAttempt={won ? correctAttempt : null}
          playing={audio.playing}
          onSeek={audio.loaded ? audio.seek : undefined}
        />
      </div>

      {/* Puntuación */}
      <div className={cn(RISE, "flex flex-col items-center")} style={riseDelay(2)}>
        {won ? (
          <>
            <p className="flex items-baseline gap-1.5 text-5xl font-bold tracking-tight text-brand">
              <AnimatedNumber value={finalScore ?? 0} format={formatNumber} delay={0.9} duration={1.1} />
              <span className="text-lg font-semibold opacity-80">{tc("points")}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("wonInAttempts", { attempt: correctAttempt ?? 0, max: maxAttempts })}
            </p>
          </>
        ) : (
          <p className="max-w-xs text-base font-medium text-muted-foreground">{t("playAgainTomorrow")}</p>
        )}
      </div>

      {/* Compartir */}
      <div className={cn(RISE, "w-full")} style={riseDelay(3)}>
        <m.button
          type="button"
          onClick={handleShare}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.97 }}
          className="ecos-shimmer flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-[15px] font-bold text-primary-foreground shadow-[0_14px_36px_-14px_var(--brand)]"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <m.span
              key={shareCopied ? "copied" : "share"}
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -14, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="flex items-center gap-2"
            >
              <span aria-hidden className="material-symbols-outlined text-xl">
                {shareCopied ? "check" : "ios_share"}
              </span>
              {shareCopied ? t("shareCopied") : t("shareResult")}
            </m.span>
          </AnimatePresence>
        </m.button>
      </div>

      {/* Banner de invitado — CTA para registrarse */}
      {isGuest && (
        <div
          className={cn(
            RISE,
            "relative w-full overflow-hidden rounded-3xl border border-brand/25 bg-gradient-to-br from-brand/15 via-card to-card p-5 text-left"
          )}
          style={riseDelay(4)}
        >
          <div aria-hidden className="absolute -right-10 -top-10 size-32 rounded-full bg-brand/20 blur-2xl" />
          <div className="relative mb-2 flex items-center gap-2">
            <span aria-hidden className="material-symbols-outlined text-xl text-brand" style={{ fontVariationSettings: "'FILL' 1" }}>
              trophy
            </span>
            <p className="text-sm font-bold">{won ? t("guestResultTitleWon") : t("guestResultTitleLost")}</p>
          </div>
          <p className="relative mb-4 text-xs leading-relaxed text-muted-foreground">{t("guestResultDescription")}</p>
          <Link
            href={loginHref}
            className="relative flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground text-sm font-bold text-background transition-transform active:scale-[0.97]"
          >
            <span aria-hidden className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
              login
            </span>
            {t("signInWithGoogle")}
          </Link>
        </div>
      )}

      {/* Acciones */}
      <div className={cn(RISE, "grid w-full grid-cols-2 gap-3")} style={riseDelay(actionsStep)}>
        <Link
          href="/ranking"
          className="group flex h-12 items-center justify-center gap-2 rounded-full border border-border bg-card/70 text-sm font-semibold backdrop-blur transition-[border-color,transform] hover:border-brand/40 active:scale-[0.97]"
        >
          <span aria-hidden className="material-symbols-outlined text-lg text-brand transition-transform duration-300 group-hover:-translate-y-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>
            leaderboard
          </span>
          {t("viewRanking")}
        </Link>
        <Link
          href="/"
          onClick={navigateBackToHome}
          className="group flex h-12 items-center justify-center gap-2 rounded-full border border-border bg-card/70 text-sm font-semibold backdrop-blur transition-[border-color,transform] hover:border-brand/40 active:scale-[0.97]"
        >
          <span aria-hidden className="material-symbols-outlined text-lg transition-transform duration-300 group-hover:-translate-x-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>
            home
          </span>
          {t("backToHome")}
        </Link>
      </div>

      {guesses.length > 0 && (
        <div className={cn(RISE, "w-full text-left")} style={riseDelay(actionsStep + 1)}>
          <PreviousAttempts guesses={guesses} title={t("yourAttempts")} className="mt-0" />
        </div>
      )}

      {!isGuest && (
        <div className={RISE} style={riseDelay(actionsStep + (guesses.length > 0 ? 2 : 1))}>
          <ReportSongDialog gameId={gameId} songId={song.id} trigger={<ReportSongTrigger />} />
        </div>
      )}

      {/* «¿Te avisamos mañana?»: único sitio donde se ofrece activar las notificaciones (UX-07).
          Solo con sesión; con el contador de descartes en 3 ya no vuelve a salir. */}
      {!isGuest && <NotificationsModal offer />}
    </div>
  );
}

export { ResultGameView };
