"use client";

import { useEffect, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import confetti from "canvas-confetti";
import { calculateScore } from "@/lib/scoring";
import { AudioPlayer } from "@/components/audio-player/AudioPlayer";
import { GuessInput } from "@/components/guess-input/GuessInput";
import { queryKeys } from "@/lib/hooks/queries";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { artistsMatch } from "@/lib/artist-match";
import { useGameStore } from "@/lib/store/gameStore";
import { useGameProgressStore, type GameProgress } from "@/lib/store/gameProgressStore";
import type { GameWithSong } from "@/lib/queries/games";
import type { EcosSong } from "@/components/guess-input/GuessInput";
import { cn } from "@/lib/utils";

interface Props {
  game: GameWithSong;
  userId: string | null; // null = invitado
}

export function GameClient({ game, userId }: Props) {
  const queryClient = useQueryClient();
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const isGuest = !userId;

  const invalidateOnGameComplete = useCallback(() => {
    if (!isGuest) {
      queryClient.invalidateQueries({ queryKey: queryKeys.home });
      queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard });
      queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    }
  }, [isGuest, queryClient]);

  const {
    phase,
    currentAttempt,
    maxAttempts,
    guesses,
    audioDuration,
    finalScore,
    correctAttempt,
    startGame,
    loadProgress,
    addGuess,
    setWon,
    setLost,
    gameId,
  } = useGameStore();

  const { getProgress, saveProgress, removeProgress } = useGameProgressStore();
  const [loadedProgress, setLoadedProgress] = useState<GameProgress | null | "loading">("loading");

  // Cargar progreso guardado o iniciar partida nueva
  useEffect(() => {
    if (loadedProgress !== "loading") return;

    const load = async () => {
      if (isGuest) {
        const progress = getProgress(game.id);
        if (progress?.phase === "playing" && progress.guesses.length > 0) {
          loadProgress(game.id, game.date, progress.guesses, progress.guesses.length + 1);
          setLoadedProgress(null);
          return;
        }
        if (progress && (progress.phase === "won" || progress.phase === "lost")) {
          setLoadedProgress(progress);
          return;
        }
        if (gameId !== game.id || phase === "idle") {
          startGame(game.id, game.date);
        }
        setLoadedProgress(null);
      } else {
        try {
          const res = await fetch(`/api/game-progress/${game.id}`);
          const data = (await res.json()) as { progress: GameProgress | null };
          const p = data.progress;
          if (p) {
            saveProgress(p);
            if (p.phase === "playing" && p.guesses.length > 0) {
              loadProgress(game.id, game.date, p.guesses, p.guesses.length + 1);
              setLoadedProgress(null);
              return;
            }
            if (p.phase === "won" || p.phase === "lost") {
              setLoadedProgress(p);
              return;
            }
          } else {
            removeProgress(game.id);
          }
        } catch {
          // continuar
        }
        if (gameId !== game.id || phase === "idle") {
          startGame(game.id, game.date);
        }
        setLoadedProgress(null);
      }
    };

    load();
  }, [game.id, game.date, gameId, phase, isGuest, getProgress, saveProgress, removeProgress, startGame, loadProgress, loadedProgress]);

  const handleGuess = useCallback(
    async (song: EcosSong) => {
      if (phase !== "playing") return;

      const guessText = `${song.title} - ${song.artist_name}`;
      const isCorrect =
        String(song.id) === String(game.ecos_songs.id) ||
        song.title.toLowerCase().trim() ===
          game.ecos_songs.title.toLowerCase().trim();

      const normalize = (s: string) => s.toLowerCase().trim();
      const correctArtist = artistsMatch(song.artist_name, game.ecos_songs.artist_name);
      const correctAlbum =
        song.album_title != null &&
        game.ecos_songs.album_title != null &&
        normalize(song.album_title) === normalize(game.ecos_songs.album_title);

      if (isCorrect) {
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
          colors: ["#2bee79", "#ffffff", "#0a2015"],
        });

        const guessEntry = {
          text: guessText,
          correct: true,
          attemptNumber: currentAttempt,
        };
        addGuess(guessEntry);

        if (isGuest) {
          const { totalPoints } = calculateScore(currentAttempt, 0);
          setWon(currentAttempt, totalPoints);
          saveProgress({
            gameId: game.id,
            gameDate: game.date,
            played: true,
            won: true,
            score: totalPoints,
            title: game.ecos_songs.title,
            artist_name: game.ecos_songs.artist_name,
            cover_url: game.ecos_songs.cover_url ?? undefined,
            guesses: useGameStore.getState().guesses,
            phase: "won",
            correctAttempt: currentAttempt,
          });
        } else {
          try {
            const res = await fetch("/api/validate-guess", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                gameId: game.id,
                userId,
                attemptNumber: currentAttempt,
                guessText,
                songId: song.id,
                guessArtistName: song.artist_name,
                guessAlbumTitle: song.album_title ?? undefined,
                finalize: true,
              }),
            });
            const data = await res.json();
            const totalPoints = data.totalPoints ?? 1000;
            setWon(currentAttempt, totalPoints);
            invalidateOnGameComplete();
          } catch {
            const { totalPoints } = calculateScore(currentAttempt, 0);
            setWon(currentAttempt, totalPoints);
            invalidateOnGameComplete();
          }
        }
      } else {
        let serverCorrectArtist = correctArtist;
        let serverCorrectAlbum = correctAlbum;

        if (!isGuest) {
          try {
            const res = await fetch("/api/validate-guess", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                gameId: game.id,
                userId,
                attemptNumber: currentAttempt,
                guessText,
                songId: song.id,
                guessArtistName: song.artist_name,
                guessAlbumTitle: song.album_title ?? undefined,
                finalize: currentAttempt >= maxAttempts,
              }),
            });
            const data = await res.json();
            serverCorrectArtist = data.correctArtist ?? correctArtist;
            serverCorrectAlbum = data.correctAlbum ?? correctAlbum;
          } catch {
            // continuar
          }
        }

        const guessEntry = {
          text: guessText,
          correct: false,
          correctArtist: serverCorrectArtist,
          correctAlbum: serverCorrectAlbum,
          attemptNumber: currentAttempt,
        };
        addGuess(guessEntry);

        if (currentAttempt >= maxAttempts) {
          setLost();
          invalidateOnGameComplete();
          if (isGuest) {
            const finalGuesses = [...useGameStore.getState().guesses, guessEntry];
            saveProgress({
              gameId: game.id,
              gameDate: game.date,
              played: true,
              won: false,
              score: null,
              title: game.ecos_songs.title,
              artist_name: game.ecos_songs.artist_name,
              cover_url: game.ecos_songs.cover_url ?? undefined,
              guesses: finalGuesses,
              phase: "lost",
            });
          }
        } else {
          if (isGuest) {
            const updatedGuesses = [...useGameStore.getState().guesses, guessEntry];
            saveProgress({
              gameId: game.id,
              gameDate: game.date,
              played: false,
              won: false,
              score: null,
              guesses: updatedGuesses,
              phase: "playing",
            });
          }
        }
      }
    },
    [phase, game, userId, isGuest, currentAttempt, maxAttempts, addGuess, setWon, setLost, saveProgress, invalidateOnGameComplete]
  );

  const song = game.ecos_songs;

  // Mostrar resumen guardado al reentrar a un juego completado
  if (loadedProgress === "loading") {
    return (
      <div className="flex min-h-full items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-4xl text-brand">
          progress_activity
        </span>
      </div>
    );
  }

  if (loadedProgress) {
    return (
      <ResultScreen
        phase={loadedProgress.phase}
        song={song}
        gameId={game.id}
        correctAttempt={loadedProgress.correctAttempt ?? null}
        finalScore={loadedProgress.score}
        maxAttempts={maxAttempts}
        gameNumber={game.game_number}
        isGuest={isGuest}
        guesses={loadedProgress.guesses}
        readOnly
      />
    );
  }

  if (phase === "won" || phase === "lost") {
    return (
      <ResultScreen
        phase={phase}
        song={song}
        gameId={game.id}
        correctAttempt={correctAttempt}
        finalScore={finalScore}
        maxAttempts={maxAttempts}
        gameNumber={game.game_number}
        isGuest={isGuest}
        guesses={guesses}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </Link>
        <h1 className="text-base font-bold">
          {t("dailyChallenge")} #{game.game_number}
        </h1>
        <button
          onClick={async () => {
            addGuess({ text: "skipped", correct: false, attemptNumber: currentAttempt });
            if (!isGuest && userId) {
              try {
                await fetch("/api/skip-attempt", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ gameId: game.id, attemptNumber: currentAttempt }),
                });
              } catch {
                // fallback: progreso en cliente
              }
            }
            if (currentAttempt >= maxAttempts) {
              setLost();
              invalidateOnGameComplete();
              if (isGuest) {
                const finalGuesses = useGameStore.getState().guesses;
                saveProgress({
                  gameId: game.id,
                  gameDate: game.date,
                  played: true,
                  won: false,
                  score: null,
                  title: game.ecos_songs.title,
                  artist_name: game.ecos_songs.artist_name,
                  cover_url: game.ecos_songs.cover_url ?? undefined,
                  guesses: finalGuesses,
                  phase: "lost",
                });
              }
            } else {
              if (isGuest) {
                const updatedGuesses = useGameStore.getState().guesses;
                saveProgress({
                  gameId: game.id,
                  gameDate: game.date,
                  played: false,
                  won: false,
                  score: null,
                  guesses: updatedGuesses,
                  phase: "playing",
                });
              }
            }
          }}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <span className="material-symbols-outlined text-lg">skip_next</span>
          {t("skip")}
        </button>
      </header>

      {/* Banner de invitado */}
      {isGuest && (
        <div className="mx-4 mb-1 flex items-center gap-2 rounded-xl bg-brand/10 px-3 py-2">
          <span
            className="material-symbols-outlined text-base text-brand"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            info
          </span>
          <p className="flex-1 text-xs text-brand/90">
            {t("guestNotice")}
          </p>
          <Link href="/login" className="text-xs font-bold text-brand underline underline-offset-2">
            {tc("enter")}
          </Link>
        </div>
      )}

      {/* Área principal: ocupa el espacio para que el panel quede abajo */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-start gap-6 px-4 py-6">
        {/* Blobs decorativos */}
        <div className="pointer-events-none absolute left-1/4 top-1/4 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/10 blur-[80px]" />
        <div className="pointer-events-none absolute right-1/4 bottom-1/4 h-32 w-32 translate-x-1/2 translate-y-1/2 rounded-full bg-blue-500/10 blur-[60px]" />

        {/* Artwork oculto con cuenta regresiva */}
        <div className="relative flex h-64 w-64 items-center justify-center overflow-hidden rounded-2xl bg-card">
          <div className="absolute inset-0 bg-gradient-to-br from-card to-secondary" />
          <motion.span
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="material-symbols-outlined relative z-10 text-6xl text-brand/60"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            music_note
          </motion.span>

          {/* Overlay de intento */}
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
            <p className="text-4xl font-bold tabular-nums text-white">
              {String(Math.floor(audioDuration / 60)).padStart(2, "0")}:
              {String(audioDuration % 60).padStart(2, "0")}
            </p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-white/60">
              {t("remaining")}
            </p>
          </div>
        </div>

        {/* Indicador de intentos */}
        <div className="flex items-center gap-1">
          {Array.from({ length: maxAttempts }).map((_, i) => {
            const guess = guesses[i];
            return (
              <div
                key={i}
                className={cn(
                  "h-2 w-2 rounded-full transition-all",
                  i < guesses.length
                    ? guess?.correct
                      ? "bg-brand"
                      : "bg-destructive"
                    : i === guesses.length
                    ? "bg-brand/50 ring-2 ring-brand/30"
                    : "bg-muted"
                )}
              />
            );
          })}
        </div>

      </div>

      {/* Panel inferior */}
      <div className="rounded-t-2xl bg-card px-4 pb-6 pt-5 shadow-[0_-4px_24px_rgba(0,0,0,0.15)]">
        <AudioPlayer
          youtubeId={song.youtube_id ?? ""}
          previewUrl={song.preview_url ?? undefined}
          maxDuration={audioDuration}
          className="mb-4"
        />
        <GuessInput
          onGuess={handleGuess}
          disabled={phase !== "playing"}
          alreadyGuessedTexts={guesses.map((g) => g.text)}
        />
        {guesses.length > 0 && (
          <PreviousAttempts guesses={guesses} />
        )}
      </div>
    </div>
  );
}

const GUESS_LABELS: Record<string, string> = {
  CORRECT: "¡Correcto!",
  WRONG_SONG: "Canción incorrecta",
  CORRECT_ARTIST: "Artista correcto",
  CORRECT_ALBUM: "Álbum correcto",
  CORRECT_ARTIST_ALBUM: "Artista y álbum correctos",
  WRONG: "Incorrecto",
  SKIPPED: "Intento saltado",
};

function PreviousAttempts({
  guesses,
}: {
  guesses: Array<{ text: string; correct?: boolean; correctArtist?: boolean; correctAlbum?: boolean }>;
}) {
  const reversed = [...guesses].reverse();

  const parseGuessText = (text: string) => {
    const sep = text.lastIndexOf(" - ");
    if (sep === -1) return { title: text, artist: "" };
    return { title: text.slice(0, sep).trim(), artist: text.slice(sep + 3).trim() };
  };

  const attemptCard = (
    g: (typeof guesses)[0],
    i: number,
    labelKey: string,
    bgClass: string,
    labelClass: string,
    icon: string,
    iconClass: string
  ) => {
    const { title, artist } = parseGuessText(g.text);
    return (
      <div
        key={i}
        className={cn(
          "flex min-h-[44px] items-center gap-2.5 rounded-lg border px-2.5 py-2",
          bgClass
        )}
      >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
        <span
          className={cn("material-symbols-outlined text-lg", iconClass)}
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {icon}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{artist}</p>
        </div>
        <span className={cn("shrink-0 text-xs font-semibold", labelClass)}>
          {GUESS_LABELS[labelKey]}
        </span>
      </div>
    );
  };

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">
        Intentos anteriores
      </h3>
      <div className="flex flex-col gap-2">
        {reversed.map((g, i) => {
          const origIndex = guesses.length - 1 - i;
          if (g.text === "skipped") {
            return (
              <div
                key={origIndex}
                className="flex min-h-[44px] items-center gap-2.5 rounded-lg border border-destructive/40 bg-destructive/15 px-2.5 py-2"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                  <span
                    className="material-symbols-outlined text-lg text-destructive"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    skip_next
                  </span>
                </div>
                <div className="min-w-0 flex-1" />
                <span className="shrink-0 text-xs font-semibold text-destructive">
                  {GUESS_LABELS.SKIPPED}
                </span>
              </div>
            );
          }
          let labelKey = "WRONG";
          let bgClass = "bg-destructive/15 border-destructive/40";
          let labelClass = "text-destructive";
          let icon = "close";
          let iconClass = "text-destructive";
          if (g.correct) {
            labelKey = "CORRECT";
            bgClass = "bg-brand/15 border-brand/40";
            labelClass = "text-brand";
            icon = "check_circle";
            iconClass = "text-brand";
          } else if (g.correctArtist || g.correctAlbum) {
            labelKey = g.correctArtist && g.correctAlbum ? "CORRECT_ARTIST_ALBUM" : g.correctArtist ? "CORRECT_ARTIST" : "CORRECT_ALBUM";
            if (g.correctAlbum) {
              bgClass = "bg-violet-500/15 border-violet-500/30";
              labelClass = "text-violet-600 dark:text-violet-400";
              icon = "album";
              iconClass = "text-violet-600 dark:text-violet-400";
            } else {
              bgClass = "bg-teal-500/15 border-teal-500/30";
              labelClass = "text-teal-600 dark:text-teal-400";
              icon = "person";
              iconClass = "text-teal-600 dark:text-teal-400";
            }
          } else {
            labelKey = "WRONG_SONG";
          }
          return attemptCard(g, origIndex, labelKey, bgClass, labelClass, icon, iconClass);
        })}
      </div>
    </div>
  );
}

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

function ResultScreen({
  phase,
  song,
  gameId,
  correctAttempt,
  finalScore,
  maxAttempts,
  gameNumber,
  isGuest,
  guesses = [],
  readOnly = false,
}: {
  phase: "won" | "lost";
  song: GameWithSong["ecos_songs"];
  gameId: string;
  correctAttempt: number | null;
  finalScore: number | null;
  maxAttempts: number;
  gameNumber: number;
  isGuest: boolean;
  guesses?: Array<{ text: string; correct?: boolean; correctArtist?: boolean; correctAlbum?: boolean }>;
  readOnly?: boolean;
}) {
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const won = phase === "won";
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>("");
  const [reportDesc, setReportDesc] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  const handleReport = async () => {
    if (!reportReason) return;
    setReportSending(true);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          songId: song.id,
          reason: reportReason,
          description: reportDesc || undefined,
        }),
      });
      if (res.ok) {
        setReportSent(true);
        setReportOpen(false);
      }
    } finally {
      setReportSending(false);
    }
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
        transition={{ delay: 0.1 }}
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
        transition={{ delay: 0.2 }}
        className="space-y-1"
      >
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {t("revealingSong")}
        </p>
        <h2 className="text-2xl font-bold">{song.title}</h2>
        <p className="text-muted-foreground">{song.artist_name}</p>
      </motion.div>

      {/* Resultado */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="w-full rounded-2xl bg-card p-5"
      >
        <div className="mb-4 flex justify-center gap-2">
          {Array.from({ length: maxAttempts }).map((_, i) => (
            <span key={i} className="text-2xl">
              {won && correctAttempt !== null
                ? i < correctAttempt - 1
                  ? "⬛"
                  : i === correctAttempt - 1
                  ? "🟩"
                  : "⬛"
                : "⬛"}
            </span>
          ))}
        </div>

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
          transition={{ delay: 0.35 }}
          className="w-full overflow-hidden rounded-2xl bg-gradient-to-br from-brand/20 to-brand/5 p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <span
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
            className="flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-[#0a2015]"
          >
            <span className="material-symbols-outlined text-base"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              login
            </span>
            {t("signInWithGoogle")}
          </Link>
        </motion.div>
      )}

      {/* Acciones */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex w-full flex-col gap-3"
      >
        <button className="flex items-center justify-center gap-2 rounded-full bg-brand py-3.5 text-sm font-bold text-[#0a2015]">
          <span className="material-symbols-outlined text-lg">share</span>
          {t("shareResult")}
        </button>
        {!isGuest && (
          <>
            <Dialog open={reportOpen} onOpenChange={setReportOpen}>
              <DialogTrigger asChild>
                <button className="flex items-center justify-center gap-2 rounded-full border border-border py-3.5 text-sm font-medium">
                  <span className="material-symbols-outlined text-lg">report</span>
                  {t("report.reportProblem")}
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("report.dialogTitle")}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {reportSent ? (
                    <p className="text-sm text-muted-foreground">
                      {t("report.thankYou")}
                    </p>
                  ) : (
                    <>
                      <div>
                        <p className="mb-2 text-sm font-medium">{t("report.reasonLabel")}</p>
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
                      </div>
                      {reportReason === "other" && (
                        <div>
                          <label className="mb-1 block text-sm font-medium">
                            {t("report.descriptionLabel")}
                          </label>
                          <textarea
                            value={reportDesc}
                            onChange={(e) => setReportDesc(e.target.value)}
                            placeholder={t("report.descriptionPlaceholder")}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                            rows={3}
                          />
                        </div>
                      )}
                      <button
                        onClick={handleReport}
                        disabled={!reportReason || reportSending}
                        className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-[#0a2015] disabled:opacity-50"
                      >
                        {reportSending ? t("report.sending") : t("report.submit")}
                      </button>
                    </>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <Link
              href="/ranking"
              className="flex items-center justify-center gap-2 rounded-full border border-border py-3.5 text-sm font-medium"
            >
              <span className="material-symbols-outlined text-lg">leaderboard</span>
              {t("viewRanking")}
            </Link>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
