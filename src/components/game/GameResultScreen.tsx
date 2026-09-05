"use client";

import { memo, useCallback, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";
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
import { PreviousAttempts } from "@/components/game/GameAttemptsList";
import { AttemptsStrip } from "@/components/game/AttemptsStrip";

/**
 * Pantalla de resultado: la canción revelada, la puntuación, compartir y el formulario de
 * reporte. `ResultGameView` es el contenedor de pantalla completa y `ResultScreen` el cuerpo.
 * Extraído de `GameClient` sin cambios de lógica.
 */

/** Duración máxima del preview en pantalla de resultado (segundos completos) */
const FULL_PREVIEW_SECONDS = 30;

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
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const { dateFnsLocale } = useAppFormatters();
  const navigateBackToHome = useNavigateBackToHome();
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioLoaded, setAudioLoaded] = useState(false);
  /** Segundo completo transcurrido: el contador solo cambia una vez por segundo. */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const resultAudioPlayerRef = useRef<AudioPlayerHandle | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const song = game.ecos_songs;

  /** Mismo motivo que en PlayingGameAudioSection: no re-renderizar esta pantalla a 60 fps. */
  const handleAudioTimeUpdate = useCallback((currentTime: number) => {
    const ratio = Math.min(currentTime / FULL_PREVIEW_SECONDS, 1);
    if (progressBarRef.current) {
      progressBarRef.current.style.width = `${ratio * 100}%`;
    }
    const whole = Math.floor(currentTime);
    setElapsedSeconds((prev) => (prev === whole ? prev : whole));
  }, []);

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <div className="absolute left-1/4 top-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/5 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 h-64 w-64 translate-x-1/2 translate-y-1/2 rounded-full bg-blue-500/5 blur-[100px]" />
      </div>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <header className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between gap-2 border-b border-border/80 bg-background/95 backdrop-blur-sm px-4 pt-safe">
          <Link
            href="/"
            onClick={navigateBackToHome}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/80"
            aria-label={tc("back")}
          >
            <span aria-hidden className="material-symbols-outlined text-xl">arrow_back</span>
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-center text-[10px] font-bold uppercase tracking-widest text-foreground/80">
            {format(parseISO(game.date), "d", { locale: dateFnsLocale })}{" "}
            {format(parseISO(game.date), "MMMM", { locale: dateFnsLocale }).toUpperCase()}
            {game.game_number != null && (
              <>
                <span className="text-foreground/50"> · </span>
                <span className="tabular-nums text-foreground/80">#{game.game_number}</span>
              </>
            )}
          </h1>
          <div className="flex w-28 shrink-0 flex-col items-end gap-0">
            <div className="flex w-full items-center gap-1.5">
              <button
                type="button"
                onClick={() => resultAudioPlayerRef.current?.togglePlay()}
                disabled={!audioLoaded}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                  audioLoaded
                    ? "bg-brand text-primary-foreground"
                    : "cursor-not-allowed bg-muted text-muted-foreground opacity-50"
                )}
                aria-label={audioPlaying ? t("listening") : t("pressPlay")}
              >
                {/* `key` por estado: mismo motivo que en GameAudioSection.tsx (glifo fantasma
                    en iOS Safari al mutar el texto del nodo en sitio). */}
                {audioLoaded ? (
                  <span aria-hidden
                    key={audioPlaying ? "stop" : "play"}
                    className="material-symbols-outlined text-xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    {audioPlaying ? "stop" : "play_arrow"}
                  </span>
                ) : (
                  <span aria-hidden key="loading" className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                )}
              </button>
              <div className="min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                {/* El ancho lo escribe handleAudioTimeUpdate; aquí el valor de partida. */}
                <div
                  ref={progressBarRef}
                  className="h-1 rounded-full bg-brand"
                  style={{ width: "0%" }}
                />
              </div>
            </div>
            <span className="-mt-0.5 leading-none text-[9px] tabular-nums text-muted-foreground">
              {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:
              {String(elapsedSeconds % 60).padStart(2, "0")} / 00:
              {String(FULL_PREVIEW_SECONDS).padStart(2, "0")}
            </span>
          </div>
        </header>
        <div className="h-14 shrink-0" aria-hidden />
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
  guesses?: Array<{ text: string; correct?: boolean; correctArtist?: boolean; correctAlbum?: boolean }>;
}) {
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { dateFnsLocale } = useAppFormatters();
  const won = phase === "won";
  const metaAlbum = song.album_title?.trim();
  const metaYear = releaseYearFromReleaseDate(song.release_date);
  const metaGenre = song.genre?.trim();
  const hasSongMeta = Boolean(metaAlbum || metaYear || metaGenre);
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
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex min-h-full flex-col items-center justify-center gap-5 px-6 py-8 text-center"
    >
      {/* Artwork */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="relative h-44 w-44 overflow-hidden rounded-2xl shadow-2xl"
      >
        {song.cover_url ? (
          <Image src={song.cover_url} alt={song.title} fill className="object-cover" sizes="176px" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-brand/20 to-card" />
        )}
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="space-y-1"
      >
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {t("revealingSong")}
        </p>
        <h2 className="text-2xl font-bold">{song.title}</h2>
        <p className="text-muted-foreground">{song.artist_name}</p>
        {hasSongMeta ? (
          <dl className="mt-3 space-y-1.5 text-left text-sm text-muted-foreground">
            {metaAlbum ? (
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                <dt className="shrink-0 font-medium text-foreground/70">{t("resultAlbum")}</dt>
                <dd className="min-w-0 break-words">{metaAlbum}</dd>
              </div>
            ) : null}
            {metaYear ? (
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                <dt className="shrink-0 font-medium text-foreground/70">{t("resultYear")}</dt>
                <dd>{metaYear}</dd>
              </div>
            ) : null}
            {metaGenre ? (
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                <dt className="shrink-0 font-medium text-foreground/70">{t("resultGenre")}</dt>
                <dd className="min-w-0 break-words">{metaGenre}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </motion.div>

      {/* Resultado (sin fondo para que sea invisible) */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="w-full rounded-2xl"
        style={{ paddingTop: "0.25rem", paddingBottom: "2.5rem", paddingLeft: "1.25rem", paddingRight: "1.25rem" }}
      >
        {/* Franja de intentos, la misma que en la pantalla de juego pero sin intento activo. */}
        <AttemptsStrip
          className="mb-5"
          guesses={guesses}
          maxAttempts={maxAttempts}
          correctAttempt={won ? correctAttempt : null}
        />

        {won ? (
          <>
            <p className="text-3xl font-bold text-brand">
              {finalScore?.toLocaleString()} {tc("points")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {correctAttempt} {t("of")} {maxAttempts} {t("attempts")}
            </p>
          </>
        ) : (
          <p className="text-base font-semibold text-muted-foreground">
            {t("playAgainTomorrow")}
          </p>
        )}
        <button
          type="button"
          onClick={handleShare}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3.5 text-sm font-bold text-primary-foreground"
        >
          <span aria-hidden className="material-symbols-outlined text-lg">share</span>
          {shareCopied ? t("shareCopied") : t("shareResult")}
        </button>
        {guesses.length > 0 && (
          <div className="mt-4 w-full">
            <PreviousAttempts guesses={guesses} />
          </div>
        )}
      </motion.div>

      {/* Banner de invitado — CTA para registrarse */}
      {isGuest && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="w-full overflow-hidden rounded-2xl bg-gradient-to-br from-brand/20 to-brand/5 p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden
              className="material-symbols-outlined text-xl text-brand"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              leaderboard
            </span>
            <p className="text-sm font-bold">
              {won ? t("guestResultTitleWon") : t("guestResultTitleLost")}
            </p>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("guestResultDescription")}
          </p>
          <Link
            href={`/login?redirect=/play`}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-primary-foreground"
          >
            <span aria-hidden className="material-symbols-outlined text-base"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              login
            </span>
            {t("signInWithGoogle")}
          </Link>
        </motion.div>
      )}

      {/* Acciones: Ver ranking, Volver al inicio, Reportar */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex w-full flex-col gap-3"
      >
        <Link
          href="/ranking"
          className="flex items-center justify-center gap-2 rounded-full border border-border py-3.5 text-sm font-medium"
        >
          <span aria-hidden
            className="material-symbols-outlined text-lg text-brand"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            leaderboard
          </span>
          {t("viewRanking")}
        </Link>
        <Link
          href="/"
          onClick={navigateBackToHome}
          className="flex items-center justify-center gap-2 rounded-full border border-border py-3.5 text-sm font-medium"
        >
          <span aria-hidden
            className="material-symbols-outlined text-lg"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            play_circle
          </span>
          {t("backToHome")}
        </Link>
        {!isGuest && (
          <Dialog open={reportOpen} onOpenChange={setReportOpen}>
            <DialogTrigger asChild>
              <button className="flex items-center justify-center gap-2 rounded-full border border-border py-3.5 text-sm font-medium">
                <span aria-hidden className="material-symbols-outlined text-lg text-destructive">report</span>
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
                    <p className="text-sm text-muted-foreground">
                      {t("report.thankYou")}
                    </p>
                  ) : (
                    <>
                      {/* fieldset/legend en vez de un <p> suelto: asi el lector de pantalla
                          sabe a que pregunta responde cada radio. El etiquetado de cada opcion
                          ya era correcto, porque el <label> envuelve al input. */}
                      <fieldset>
                        <legend className="mb-2 text-sm font-medium">
                          {t("report.reasonLabel")}
                        </legend>
                        <div className="space-y-2">
                          {REPORT_REASON_IDS.map((id) => (
                            <label
                              key={id}
                              className="flex cursor-pointer items-center gap-2"
                            >
                              <input
                                type="radio"
                                name="reason"
                                value={id}
                                checked={reportReason === id}
                                onChange={() => setReportReason(id)}
                                className="h-4 w-4"
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
                          <label
                            htmlFor={reportDescId}
                            className="mb-1 block text-sm font-medium"
                          >
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
        )}
      </motion.div>
    </motion.div>
  );
}

export { ResultGameView, ResultScreen, FULL_PREVIEW_SECONDS };
