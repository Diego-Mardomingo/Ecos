"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { format, parseISO } from "date-fns";
import { es, enUS } from "date-fns/locale";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import confetti from "canvas-confetti";
import { calculateScore } from "@/lib/scoring";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/audio-player/AudioPlayer";
import { GuessInput } from "@/components/guess-input/GuessInput";
import { queryKeys } from "@/lib/hooks/queries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

/** Duración máxima del preview en pantalla de resultado (segundos completos) */
const FULL_PREVIEW_SECONDS = 30;

interface Props {
  game: GameWithSong;
  userId: string | null; // null = invitado
}

export function GameClient({ game, userId }: Props) {
  const queryClient = useQueryClient();
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = locale === "es" ? es : enUS;
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
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const audioPlayerRef = useRef<AudioPlayerHandle | null>(null);
  const resultAudioPlayerRef = useRef<AudioPlayerHandle | null>(null);

  useEffect(() => {
    setAudioCurrentTime(0);
  }, [audioDuration]);

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
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
        <span
          className="material-symbols-outlined animate-spin text-6xl text-brand"
          aria-hidden
        >
          progress_activity
        </span>
        <p className="text-sm text-muted-foreground">{t("loadingGame")}</p>
      </div>
    );
  }

  const isResultView =
    phase === "won" ||
    phase === "lost" ||
    (loadedProgress &&
      loadedProgress !== "loading" &&
      (loadedProgress.phase === "won" || loadedProgress.phase === "lost"));

  if (isResultView) {
    const resultPhase = loadedProgress && loadedProgress !== "loading" ? loadedProgress.phase : phase;
    const resultCorrectAttempt =
      loadedProgress && loadedProgress !== "loading"
        ? loadedProgress.correctAttempt ?? null
        : correctAttempt;
    const resultFinalScore =
      loadedProgress && loadedProgress !== "loading" ? loadedProgress.score : finalScore;
    const resultGuesses =
      loadedProgress && loadedProgress !== "loading" ? loadedProgress.guesses : guesses;
    const resultReadOnly = Boolean(loadedProgress && loadedProgress !== "loading");

    const progress = Math.min((audioCurrentTime / FULL_PREVIEW_SECONDS) * 100, 100);
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
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/80"
              aria-label={tc("back")}
            >
              <span className="material-symbols-outlined text-xl">arrow_back</span>
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
                      ? "bg-brand text-[#0a2015]"
                      : "cursor-not-allowed bg-muted text-muted-foreground opacity-50"
                  )}
                  aria-label={audioPlaying ? t("listening") : t("pressPlay")}
                >
                  {audioLoaded ? (
                    <span
                      className="material-symbols-outlined text-xl"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      {audioPlaying ? "stop" : "play_arrow"}
                    </span>
                  ) : (
                    <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                  )}
                </button>
                <div className="min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-1 rounded-full bg-brand transition-[width] duration-75 ease-linear"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
              <span className="-mt-0.5 leading-none text-[9px] tabular-nums text-muted-foreground">
                {String(Math.floor(audioCurrentTime / 60)).padStart(2, "0")}:
                {String(Math.floor(audioCurrentTime % 60)).padStart(2, "0")} / 00:
                {String(FULL_PREVIEW_SECONDS).padStart(2, "0")}
              </span>
            </div>
          </header>
          <div className="h-14 shrink-0" aria-hidden />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ResultScreen
              phase={resultPhase}
              song={song}
              gameId={game.id}
              correctAttempt={resultCorrectAttempt}
              finalScore={resultFinalScore}
              maxAttempts={maxAttempts}
              gameNumber={game.game_number}
              isGuest={isGuest}
              guesses={resultGuesses}
              readOnly={resultReadOnly}
            />
          </div>
        </div>
        <AudioPlayer
          ref={resultAudioPlayerRef}
          youtubeId={song.youtube_id ?? ""}
          previewUrl={song.preview_url ?? undefined}
          maxDuration={FULL_PREVIEW_SECONDS}
          onTimeUpdate={setAudioCurrentTime}
          onPlayingChange={setAudioPlaying}
          onLoadedChange={setAudioLoaded}
          onEnded={() => {
              setAudioCurrentTime(0);
              setTimeout(() => setAudioCurrentTime(0), 150);
            }}
          hideControls
        />
      </div>
    );
  }

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  /** Para el countdown: redondeamos hacia arriba para no mostrar 00:00 hasta llegar a 0 */
  const formatTimeRemaining = (s: number) => {
    if (s <= 0) return "00:00";
    const secs = Math.ceil(s);
    return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  };

  return (
    <div className="relative flex flex-col bg-background">
      {/* Fondo de efectos a pantalla completa (sutil para no restar contraste a las barras) */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <div className="absolute left-1/4 top-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/5 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 h-64 w-64 translate-x-1/2 translate-y-1/2 rounded-full bg-blue-500/5 blur-[100px]" />
      </div>

      <div className="relative z-10 flex flex-col">
      {/* Header fijo — back (más cuadrado), fecha + id, botón Saltar con texto */}
      <header className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between border-b border-border/80 bg-background/95 backdrop-blur-sm px-4 pt-safe">
        <Link
          href="/"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/80"
          aria-label={tc("back")}
        >
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </Link>
        <h1 className="text-center text-[10px] font-bold uppercase tracking-widest text-foreground/80">
          {format(parseISO(game.date), "d", { locale: dateFnsLocale })}{" "}
          {format(parseISO(game.date), "MMMM", { locale: dateFnsLocale }).toUpperCase()}
          {game.game_number != null && (
            <>
              <span className="text-foreground/50"> · </span>
              <span className="tabular-nums text-foreground/80">#{game.game_number}</span>
            </>
          )}
        </h1>
        <button
          type="button"
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
          className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <span className="material-symbols-outlined text-lg">skip_next</span>
          {t("skip")}
        </button>
      </header>

      {/* Espaciador para el header fijo */}
      <div className="h-14 shrink-0" aria-hidden />

      {/* Tiempo + barra horizontal (justo bajo el header) */}
      <div className="flex w-full flex-col items-center px-4 pb-4 pt-1">
        <span className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
          {formatTimeRemaining(Math.max(0, audioDuration - audioCurrentTime))}
        </span>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand will-change-[width] transition-[width] duration-[120ms] ease-linear"
            style={{
              width: `${Math.min((audioCurrentTime / audioDuration) * 100, 100)}%`,
            }}
          />
        </div>
      </div>

      {/* Banner de invitado */}
      {isGuest && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 px-3 py-2">
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

      {/* Área principal: play + anillo + dots (solo el espacio que necesita, sin crecer) */}
      <div className="relative flex shrink-0 flex-col items-center justify-start gap-3 px-4 pt-4 pb-2 overflow-hidden">
        {/* Reproductor circular (estilos del boceto: anillo + botón + banner pegado abajo) */}
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
              <circle
                cx="96"
                cy="96"
                r="80"
                fill="transparent"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                className="text-brand will-change-[stroke-dashoffset] transition-[stroke-dashoffset] duration-[120ms] ease-linear"
                strokeDasharray={502.65}
                strokeDashoffset={502.65 * (1 - Math.min(audioCurrentTime / audioDuration, 1))}
              />
            </svg>
            <motion.button
              type="button"
              onClick={() => audioPlayerRef.current?.togglePlay()}
              whileTap={{ scale: 0.95 }}
              whileHover={{ scale: audioLoaded ? 1.05 : 1 }}
              disabled={!audioLoaded}
              className={cn(
                "absolute flex size-32 items-center justify-center rounded-full shadow-lg transition-transform",
                audioLoaded
                  ? "bg-brand text-[#0a2015] shadow-brand/20 hover:scale-105 active:scale-95"
                  : "cursor-not-allowed bg-muted opacity-50 text-muted-foreground"
              )}
              aria-label={audioPlaying ? t("listening") : t("pressPlay")}
            >
              {audioLoaded ? (
                <span
                  className="material-symbols-outlined font-bold inline-block"
                  style={{
                    fontVariationSettings: "'FILL' 1, 'opsz' 48",
                    fontSize: "3.25rem",
                  }}
                >
                  {audioPlaying ? "stop" : "play_arrow"}
                </span>
              ) : (
                <span
                  className="material-symbols-outlined animate-spin inline-block"
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

        {/* Indicador de intentos (dots): correcto=verde, fallo=rojo, actual=anillo, pendiente=gris */}
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

      {/* Panel inferior: búsqueda (contenedor invisible, algo de espacio sobre los dots) */}
      <div className="px-4 pb-8 pt-5">
        <AudioPlayer
          ref={audioPlayerRef}
          youtubeId={song.youtube_id ?? ""}
          previewUrl={song.preview_url ?? undefined}
          maxDuration={audioDuration}
          onTimeUpdate={setAudioCurrentTime}
          onPlayingChange={setAudioPlaying}
          onLoadedChange={setAudioLoaded}
          hideControls
          className="mb-3"
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
    </div>
  );
}

const GUESS_LABEL_KEYS: Record<string, string> = {
  CORRECT: "correct",
  WRONG_SONG: "wrongSong",
  CORRECT_ARTIST: "correctArtist",
  CORRECT_ALBUM: "correctAlbum",
  CORRECT_ARTIST_ALBUM: "correctArtistAlbum",
  WRONG: "wrong",
  SKIPPED: "skipped",
};

function PreviousAttempts({
  guesses,
}: {
  guesses: Array<{ text: string; correct?: boolean; correctArtist?: boolean; correctAlbum?: boolean }>;
}) {
  const t = useTranslations("game");
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
          "flex min-h-[44px] flex-row items-center gap-2.5 rounded-lg border px-2.5 py-2",
          bgClass
        )}
      >
        {/* Icono centrado verticalmente */}
        <div className="flex w-14 shrink-0 items-center justify-center sm:w-auto sm:block">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50">
            <span
              className={cn("material-symbols-outlined text-lg", iconClass)}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {icon}
            </span>
          </div>
        </div>
        {/* Contenido: etiqueta, título y artista alineados a la izquierda */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className={cn("text-xs font-semibold", labelClass)}>
            {t(GUESS_LABEL_KEYS[labelKey] as keyof IntlMessages["game"])}
          </span>
          {title ? <p className="break-words text-sm font-medium">{title}</p> : null}
          {artist ? (
            <p className="break-words text-xs text-muted-foreground">{artist}</p>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">
        {t("previousAttempts")}
      </h3>
      <div className="flex flex-col gap-2">
        {reversed.map((g, i) => {
          const origIndex = guesses.length - 1 - i;
          if (g.text === "skipped") {
            return (
              <div
                key={origIndex}
                className="flex min-h-[44px] flex-row items-center gap-2.5 rounded-lg border border-destructive/40 bg-destructive/15 px-2.5 py-2"
              >
                <div className="flex w-14 shrink-0 items-center justify-center sm:w-auto sm:block">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50">
                    <span
                      className="material-symbols-outlined text-lg text-destructive"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      skip_next
                    </span>
                  </div>
                </div>
                <span className="text-left text-xs font-semibold text-destructive">
                  {t("skipped")}
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
            labelKey = g.correctAlbum ? "CORRECT_ALBUM" : "CORRECT_ARTIST";
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
  const locale = useLocale();
  const won = phase === "won";
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>("");
  const [reportDesc, setReportDesc] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

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
    const textWithEmojis = `${emojiIntro} ${scoreText}\n\n${dotsEmoji}\n\n👇 ${inviteText}`;
    const fullTextForClipboard = `${emojiIntro} ${scoreText}\n\n${dotsEmoji}\n\n👇 ${inviteText} ${shareUrl}`;
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

      {/* Resultado (sin fondo para que sea invisible) */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="w-full rounded-2xl"
        style={{ paddingTop: "0.25rem", paddingBottom: "2.5rem", paddingLeft: "1.25rem", paddingRight: "1.25rem" }}
      >
        {/* Dots de intentos (mismo estilo que en la pantalla de juego) */}
        <div className="mb-5 flex justify-center gap-1">
          {Array.from({ length: maxAttempts }).map((_, i) => {
            const isWinningAttempt = won && correctAttempt !== null && i === correctAttempt - 1;
            const isPending = won && correctAttempt !== null && i > correctAttempt - 1;
            const guess = guesses[i];
            const isCorrect = guess?.correct === true;
            const dotClass = isWinningAttempt
              ? "bg-brand"
              : isPending
                ? "bg-muted"
                : isCorrect
                  ? "bg-brand"
                  : "bg-destructive";
            return (
              <div
                key={i}
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                aria-hidden
              >
                <div className={cn("h-2.5 w-2.5 rounded-full", dotClass)} />
              </div>
            );
          })}
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
        <button
          type="button"
          onClick={handleShare}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3.5 text-sm font-bold text-[#0a2015]"
        >
          <span className="material-symbols-outlined text-lg">share</span>
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

      {/* Acciones: Ver ranking, Volver al inicio, Reportar */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex w-full flex-col gap-3"
      >
        <Link
          href="/ranking"
          className="flex items-center justify-center gap-2 rounded-full border border-border py-3.5 text-sm font-medium"
        >
          <span
            className="material-symbols-outlined text-lg text-brand"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            leaderboard
          </span>
          {t("viewRanking")}
        </Link>
        <Link
          href="/"
          className="flex items-center justify-center gap-2 rounded-full border border-border py-3.5 text-sm font-medium"
        >
          <span
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
                <span className="material-symbols-outlined text-lg text-destructive">report</span>
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
        )}
      </motion.div>
    </motion.div>
  );
}
