"use client";

import { useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import confetti from "canvas-confetti";
import { calculateScore } from "@/lib/scoring";
import { AudioPlayer } from "@/components/audio-player/AudioPlayer";
import { GuessInput } from "@/components/guess-input/GuessInput";
import { useGameStore, ATTEMPT_DURATIONS } from "@/lib/store/gameStore";
import type { GameWithSong } from "@/lib/queries/games";
import type { DeezerTrack } from "@/lib/deezer";
import { cn } from "@/lib/utils";

interface Props {
  game: GameWithSong;
  userId: string | null; // null = invitado
}

export function GameClient({ game, userId }: Props) {
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const isGuest = !userId;

  const {
    phase,
    currentAttempt,
    maxAttempts,
    guesses,
    hintsUsed,
    maxHints,
    audioDuration,
    finalScore,
    correctAttempt,
    startGame,
    addGuess,
    useHint,
    setWon,
    setLost,
    gameId,
  } = useGameStore();

  // Iniciar partida si no estaba en curso para este juego
  useEffect(() => {
    if (gameId !== game.id && phase === "idle") {
      startGame(game.id, game.date);
    }
  }, [game.id, game.date, gameId, phase, startGame]);

  const handleGuess = useCallback(
    async (track: DeezerTrack) => {
      if (phase !== "playing") return;

      const guessText = `${track.title} - ${track.artist.name}`;
      const isCorrect =
        String(track.id) === String(game.ecos_songs.id) ||
        track.title.toLowerCase().trim() ===
          game.ecos_songs.title.toLowerCase().trim();

      if (isCorrect) {
        // Lanzar confetti
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
          colors: ["#2bee79", "#ffffff", "#0a2015"],
        });

        if (isGuest) {
          // Invitado: calcular puntuación localmente, no persistir en servidor
          const { totalPoints } = calculateScore(currentAttempt, 0);
          addGuess({ text: guessText, correct: true, attemptNumber: currentAttempt });
          setWon(currentAttempt, totalPoints);
        } else {
          // Usuario autenticado: registrar y puntuar en el servidor
          try {
            const res = await fetch("/api/validate-guess", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                gameId: game.id,
                userId,
                attemptNumber: currentAttempt,
                guessText,
                deezerTrackId: track.id,
                finalize: true,
              }),
            });
            const data = await res.json();
            addGuess({ text: guessText, correct: true, attemptNumber: currentAttempt });
            setWon(currentAttempt, data.totalPoints ?? 1000);
          } catch {
            const { totalPoints } = calculateScore(currentAttempt, 0);
            addGuess({ text: guessText, correct: true, attemptNumber: currentAttempt });
            setWon(currentAttempt, totalPoints);
          }
        }
      } else {
        addGuess({ text: guessText, correct: false, attemptNumber: currentAttempt });

        if (!isGuest) {
          // Registrar intento fallido en el servidor
          try {
            await fetch("/api/validate-guess", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                gameId: game.id,
                userId,
                attemptNumber: currentAttempt,
                guessText,
                deezerTrackId: track.id,
              }),
            });
          } catch {
            // Continuar aunque falle el registro
          }
        }

        if (currentAttempt >= maxAttempts) {
          if (!isGuest) {
            // Registrar derrota en el servidor
            try {
              await fetch("/api/validate-guess", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  gameId: game.id,
                  userId,
                  attemptNumber: currentAttempt,
                  guessText,
                  deezerTrackId: track.id,
                  finalize: true,
                }),
              });
            } catch {
              // continuar
            }
          }
          setLost();
        }
      }
    },
    [phase, game, userId, isGuest, currentAttempt, maxAttempts, addGuess, setWon, setLost]
  );

  const song = game.ecos_songs;

  if (phase === "won" || phase === "lost") {
    return (
      <ResultScreen
        phase={phase}
        song={song}
        correctAttempt={correctAttempt}
        finalScore={finalScore}
        maxAttempts={maxAttempts}
        gameNumber={game.game_number}
        isGuest={isGuest}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </Link>
        <h1 className="text-base font-bold">
          {t("dailyChallenge")} #{game.game_number}
        </h1>
        <button
          onClick={() => {
            addGuess({ text: "skipped", correct: false, attemptNumber: currentAttempt });
            if (currentAttempt >= maxAttempts) setLost();
          }}
          className="text-sm font-medium text-muted-foreground"
        >
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
            Juegas como invitado — tu puntuación no se guarda en el ranking.
          </p>
          <Link href="/login" className="text-xs font-bold text-brand underline underline-offset-2">
            Entrar
          </Link>
        </div>
      )}

      {/* Área principal */}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-4 py-4">
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

        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={useHint}
            disabled={hintsUsed >= maxHints}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-all disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-base text-brand"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              lightbulb
            </span>
            {t("hint")} ({maxHints - hintsUsed})
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium"
          >
            <span className="material-symbols-outlined text-base text-brand">group</span>
            {t("askFriends")}
          </motion.button>
        </div>
      </div>

      {/* Panel inferior */}
      <div className="rounded-t-[2rem] bg-card px-4 pb-6 pt-5 shadow-[0_-4px_24px_rgba(0,0,0,0.15)]">
        <AudioPlayer
          previewUrl={song.preview_url}
          maxDuration={audioDuration}
          className="mb-4"
        />
        <GuessInput onGuess={handleGuess} disabled={phase !== "playing"} />
      </div>
    </div>
  );
}

function ResultScreen({
  phase,
  song,
  correctAttempt,
  finalScore,
  maxAttempts,
  gameNumber,
  isGuest,
}: {
  phase: "won" | "lost";
  song: GameWithSong["ecos_songs"];
  correctAttempt: number | null;
  finalScore: number | null;
  maxAttempts: number;
  gameNumber: number;
  isGuest: boolean;
}) {
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const won = phase === "won";

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
          <Image src={song.cover_url} alt={song.title} fill className="object-cover" />
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
              {won ? "¡Buen resultado! Guárdalo en el ranking" : "¿A ver si mañana lo consigues?"}
            </p>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Inicia sesión para que tu puntuación cuente en el ranking global y puedas competir con otros jugadores.
          </p>
          <Link
            href={`/login?redirect=/play`}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-[#0a2015]"
          >
            <span className="material-symbols-outlined text-base"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              login
            </span>
            Iniciar sesión con Google
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
          <Link
            href="/ranking"
            className="flex items-center justify-center gap-2 rounded-full border border-border py-3.5 text-sm font-medium"
          >
            <span className="material-symbols-outlined text-lg">leaderboard</span>
            Ver ranking
          </Link>
        )}
      </motion.div>
    </motion.div>
  );
}
