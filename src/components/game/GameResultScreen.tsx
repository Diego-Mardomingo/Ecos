"use client";

import { memo, useCallback, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format, parseISO } from "date-fns";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import Image from "next/image";
import { toast } from "sonner";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/audio-player/AudioPlayer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import { useReportGameMutation, type ReportGameInput } from "@/lib/hooks/queries";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { useNavigateBackToHome } from "@/lib/navigation/useNavigateBackToHome";
import type { GameWithSong } from "@/lib/queries/games";
import { releaseYearFromReleaseDate } from "@/lib/song-display";
import type { GamePhase, GuessEntry } from "@/lib/store/gameStore";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { PreviousAttempts } from "@/components/game/GameAttemptsList";
import { GameBackdrop } from "@/components/game/GameBackdrop";
import { GameHeader } from "@/components/game/GameHeader";
import { PlayButton } from "@/components/game/PlayButton";
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
const ALL_SEGMENTS = 6;

const REPORT_REASON_IDS = [
  "bad_audio",
  "wrong_video",
  "intro_problem",
  "explicit_content",
  "other",
] as const;
const REPORT_REASON_KEYS: Record<(typeof REPORT_REASON_IDS)[number], string> = {
  bad_audio: "report.reasonBadAudio",
  wrong_video: "report.reasonWrongVideo",
  intro_problem: "report.reasonIntroProblem",
  explicit_content: "report.reasonExplicit",
  other: "report.reasonOther",
};

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const sequence: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.45 } },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

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
  const [audioLoaded, setAudioLoaded] = useState(false);
  /** Segundo completo transcurrido: el reloj solo cambia una vez por segundo. */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const resultAudioPlayerRef = useRef<AudioPlayerHandle | null>(null);
  const waveformRef = useRef<SegmentedWaveformHandle | null>(null);
  const song = game.ecos_songs;

  /** Mismo motivo que en PlayingGameAudioSection: no re-renderizar esta pantalla a 60 fps. */
  const handleAudioTimeUpdate = useCallback((currentTime: number) => {
    waveformRef.current?.setTime(currentTime);
    const whole = Math.floor(currentTime);
    setElapsedSeconds((prev) => (prev === whole ? prev : whole));
  }, []);

  const togglePlay = useCallback(() => {
    resultAudioPlayerRef.current?.togglePlay();
  }, []);

  const seek = useCallback((seconds: number) => {
    resultAudioPlayerRef.current?.seekTo(seconds);
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
              loaded: audioLoaded,
              elapsedSeconds,
              toggle: togglePlay,
              seek,
            }}
            waveformRef={waveformRef}
          />
        </div>
      </div>
      <AudioPlayer
        ref={resultAudioPlayerRef}
        previewUrl={song.preview_url ? `/api/audio-proxy?gameId=${game.id}` : undefined}
        maxDuration={FULL_PREVIEW_SECONDS}
        onTimeUpdate={handleAudioTimeUpdate}
        onPlayingChange={setAudioPlaying}
        onLoadedChange={setAudioLoaded}
        onEnded={() => {
          handleAudioTimeUpdate(0);
          setTimeout(() => handleAudioTimeUpdate(0), 150);
        }}
        hideControls
      />
    </div>
  );
});

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
    loaded: boolean;
    elapsedSeconds: number;
    toggle: () => void;
    seek: (seconds: number) => void;
  };
  /**
   * Aparte de `audio` a propósito: dentro de ese objeto, el compilador de React trataría el
   * objeto entero como una ref y daría por prohibido leer cualquiera de sus campos al renderizar.
   */
  waveformRef: React.RefObject<SegmentedWaveformHandle | null>;
}) {
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { dateFnsLocale, formatNumber } = useAppFormatters();
  const won = phase === "won";
  const metaAlbum = song.album_title?.trim();
  const metaYear = releaseYearFromReleaseDate(song.release_date);
  const metaGenre = song.genre?.trim();
  const songMeta = [metaAlbum, metaYear, metaGenre].filter(Boolean) as string[];
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>("");
  const [reportDesc, setReportDesc] = useState("");
  const reportDescId = useId();
  const [reportSent, setReportSent] = useState(false);
  const reportMutation = useReportGameMutation();
  const [shareCopied, setShareCopied] = useState(false);
  const navigateBackToHome = useNavigateBackToHome();

  const handleShare = async () => {
    const shareUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/${locale}/play/${gameId}`
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
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title,
          text: textWithEmojis,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(fullTextForClipboard);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        try {
          await navigator.clipboard.writeText(fullTextForClipboard);
          setShareCopied(true);
          setTimeout(() => setShareCopied(false), 2000);
        } catch {
          // ignore
        }
      }
    }
  };

  const handleReport = () => {
    if (!reportReason) return;
    reportMutation.mutate(
      {
        gameId,
        songId: song.id,
        reason: reportReason as ReportGameInput["reason"],
        description: reportDesc.trim() || undefined,
      },
      {
        onSuccess: () => {
          setReportSent(true);
          setReportOpen(false);
        },
        onError: () => {
          toast.error(tc("error"));
        },
      }
    );
  };

  return (
    <motion.div
      variants={sequence}
      initial="hidden"
      animate="show"
      className="flex min-h-full flex-col items-center gap-6 px-5 pb-12 pt-6 text-center"
    >
      {/* Carátula + vinilo. El grupo se desplaza a la izquierda a la vez que el vinilo asoma por la
          derecha, para que el conjunto siga centrado. */}
      <motion.div
        initial={{ x: 0 }}
        animate={{ x: "-17%" }}
        transition={{ delay: 0.55, type: "spring", stiffness: 140, damping: 20 }}
        className="relative size-[200px] shrink-0"
      >
        <motion.div
          aria-hidden
          initial={{ x: 0, opacity: 0 }}
          animate={{ x: "36%", opacity: 1 }}
          transition={{ delay: 0.55, type: "spring", stiffness: 140, damping: 20 }}
          className="absolute inset-[4%] rounded-full shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)]"
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
        </motion.div>

        <motion.button
          type="button"
          onClick={audio.loaded ? audio.toggle : undefined}
          aria-label={audio.playing ? t("stopSong") : t("listenSong")}
          initial={{ scale: 0.82, opacity: 0, rotate: -6, filter: "blur(14px)" }}
          animate={{ scale: 1, opacity: 1, rotate: 0, filter: "blur(0px)" }}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
          className="group relative block size-full overflow-hidden rounded-2xl shadow-[0_24px_50px_-16px_rgba(0,0,0,0.75)] ring-1 ring-white/10"
        >
          {song.cover_url ? (
            <Image src={song.cover_url} alt={song.title} fill className="object-cover" sizes="200px" priority />
          ) : (
            <div className="size-full bg-gradient-to-br from-brand/30 to-card" />
          )}
          {/* Brillo diagonal que cruza la carátula una vez al revelarse. */}
          <motion.span
            aria-hidden
            initial={{ x: "-120%" }}
            animate={{ x: "120%" }}
            transition={{ delay: 0.6, duration: 0.9, ease: "easeInOut" }}
            className="absolute inset-0 bg-[linear-gradient(105deg,transparent_35%,rgba(255,255,255,0.35)_50%,transparent_65%)]"
          />
        </motion.button>

        <div className="absolute -bottom-4 -right-4 z-10">
          <PlayButton
            playing={audio.playing}
            loaded={audio.loaded}
            onClick={audio.toggle}
            size={60}
            labels={{ play: t("listenSong"), stop: t("stopSong"), loading: t("loadingAudio") }}
          />
        </div>
      </motion.div>

      {/* Veredicto + canción */}
      <motion.div variants={rise} className="mt-2 flex w-full flex-col items-center gap-2">
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
              <motion.li
                key={item}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.75 + i * 0.06, type: "spring", stiffness: 420, damping: 24 }}
                className="max-w-full truncate rounded-full border border-border bg-card/70 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur"
              >
                {item}
              </motion.li>
            ))}
          </ul>
        ) : null}
      </motion.div>

      {/* Onda: la canción entera, con los tramos coloreados por cómo fue cada intento. */}
      <motion.div variants={rise} className="w-full rounded-3xl border border-border bg-card/80 p-4 backdrop-blur">
        <SegmentedWaveform
          ref={waveformRef}
          seed={gameId}
          unlockedCount={ALL_SEGMENTS}
          guesses={guesses}
          correctAttempt={won ? correctAttempt : null}
          playing={audio.playing}
          onSeek={audio.loaded ? audio.seek : undefined}
          seekLabel={t("seekLabel")}
          valueSeconds={audio.elapsedSeconds}
        />
        <div className="mt-2 flex justify-between text-[11px] font-medium tabular-nums text-muted-foreground">
          <span>{formatClock(audio.elapsedSeconds)}</span>
          <span>{formatClock(FULL_PREVIEW_SECONDS)}</span>
        </div>
      </motion.div>

      {/* Puntuación */}
      <motion.div variants={rise} className="flex flex-col items-center">
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
      </motion.div>

      {/* Compartir */}
      <motion.div variants={rise} className="w-full">
        <motion.button
          type="button"
          onClick={handleShare}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.97 }}
          className="ecos-shimmer flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-[15px] font-bold text-primary-foreground shadow-[0_14px_36px_-14px_var(--brand)]"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
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
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </motion.div>

      {/* Banner de invitado — CTA para registrarse */}
      {isGuest && (
        <motion.div
          variants={rise}
          className="relative w-full overflow-hidden rounded-3xl border border-brand/25 bg-gradient-to-br from-brand/15 via-card to-card p-5 text-left"
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
            href={`/login?redirect=/play`}
            className="relative flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground text-sm font-bold text-background transition-transform active:scale-[0.97]"
          >
            <span aria-hidden className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
              login
            </span>
            {t("signInWithGoogle")}
          </Link>
        </motion.div>
      )}

      {/* Acciones */}
      <motion.div variants={rise} className="grid w-full grid-cols-2 gap-3">
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
      </motion.div>

      {guesses.length > 0 && (
        <motion.div variants={rise} className="w-full text-left">
          <PreviousAttempts guesses={guesses} title={t("yourAttempts")} className="mt-0" />
        </motion.div>
      )}

      {!isGuest && (
        <motion.div variants={rise}>
          <Dialog open={reportOpen} onOpenChange={setReportOpen}>
            <DialogTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <span aria-hidden className="material-symbols-outlined text-base">flag</span>
                {t("report.reportProblemWithSong")}
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("report.dialogTitle")}</DialogTitle>
                <DialogDescription className="sr-only">{t("report.reportProblemWithSong")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {reportSent ? (
                  <p className="text-sm text-muted-foreground">{t("report.thankYou")}</p>
                ) : (
                  <>
                    {/* fieldset/legend en vez de un <p> suelto: asi el lector de pantalla
                        sabe a que pregunta responde cada radio. El etiquetado de cada opcion
                        ya era correcto, porque el <label> envuelve al input. */}
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium">{t("report.reasonLabel")}</legend>
                      <div className="space-y-2">
                        {REPORT_REASON_IDS.map((id) => (
                          <label
                            key={id}
                            className={cn(
                              "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors",
                              reportReason === id ? "border-brand/50 bg-brand/8" : "border-border hover:bg-muted/60"
                            )}
                          >
                            <input
                              type="radio"
                              name="reason"
                              value={id}
                              checked={reportReason === id}
                              onChange={() => setReportReason(id)}
                              className="h-4 w-4 accent-[var(--brand)]"
                            />
                            <span className="text-sm">{t(REPORT_REASON_KEYS[id])}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {reportReason === "other" && (
                      <div>
                        {/* El label no tenia htmlFor ni el textarea id, asi que no estaban
                            asociados: el campo se anunciaba sin nombre. */}
                        <label htmlFor={reportDescId} className="mb-1 block text-sm font-medium">
                          {t("report.descriptionLabel")}
                        </label>
                        <textarea
                          id={reportDescId}
                          value={reportDesc}
                          onChange={(e) => setReportDesc(e.target.value)}
                          placeholder={t("report.descriptionPlaceholder")}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                          rows={3}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleReport}
                      disabled={!reportReason || reportMutation.isPending}
                      className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50"
                    >
                      {reportMutation.isPending ? t("report.sending") : t("report.submit")}
                    </button>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </motion.div>
      )}
    </motion.div>
  );
}

export { ResultGameView };
