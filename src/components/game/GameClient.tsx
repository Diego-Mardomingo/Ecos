"use client";

import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useState,
  useRef,
  useMemo,
} from "react";
import { useTranslations } from "next-intl";
import { format, parseISO } from "date-fns";
import confetti from "canvas-confetti";
import { useTheme } from "next-themes";
import { calculateScore } from "@/lib/scoring";
import { type AudioPlayerHandle } from "@/components/audio-player/AudioPlayer";
import { GuessInput } from "@/components/guess-input/GuessInput";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSkipAttemptMutation,
  useValidateGuessMutation,
  useGameProgressById,
  queryKeys,
  type GameProgressData,
} from "@/lib/hooks/queries";
import { artistsMatch } from "@/lib/artist-match";
import {
  ATTEMPT_DURATIONS,
  useGameStore,
  type GamePhase,
} from "@/lib/store/gameStore";
import { useGameProgressStore, type GameProgress } from "@/lib/store/gameProgressStore";
import type { GameWithSong } from "@/lib/queries/games";
import type { EcosSong } from "@/components/guess-input/GuessInput";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import {
  PLAY_FROM_HOME_STORAGE_KEY,
  useNavigateBackToHome,
} from "@/lib/navigation/useNavigateBackToHome";
import { PLAY_SKELETON_VARIANT_KEY } from "@/lib/navigation/playSkeletonStorage";
import { PLAY_NAVIGATION_END_EVENT } from "@/lib/navigation/playNavigationEvents";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { PreviousAttempts } from "@/components/game/GameAttemptsList";
import { PlayingGameAudioSection } from "@/components/game/GameAudioSection";
import { ResultGameView } from "@/components/game/GameResultScreen";

/** Ventana corta para ignorar dobles taps accidentales en “Saltar intento”. */
const SKIP_BUTTON_DOUBLE_TAP_GUARD_MS = 500;
const CONFETTI_COLORS_DARK = ["#2bee79", "#ffffff", "#0a2015"] as const;
const CONFETTI_COLORS_LIGHT = ["#059669", "#ffffff", "#f8fafc"] as const;

interface EcosPerfMetrics {
  playFirstPaintMs: number[];
  playProgressSyncMs: number[];
  playMountAtMs: number | null;
}

interface Props {
  game: GameWithSong;
  userId: string | null; // null = invitado
}

export function GameClient({ game, userId }: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const { dateFnsLocale } = useAppFormatters();
  const isGuest = !userId;
  const validateGuessMutation = useValidateGuessMutation();
  const skipAttemptMutation = useSkipAttemptMutation();
  const navigateBackToHomePlaying = useNavigateBackToHome();

  useEffect(() => {
    router.prefetch("/");
    router.prefetch("/ranking");
  }, [router]);

  useLayoutEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent(PLAY_NAVIGATION_END_EVENT));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav?.type === "reload") {
      try {
        sessionStorage.removeItem(PLAY_FROM_HOME_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.removeItem(PLAY_SKELETON_VARIANT_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "ecos_play_nav_start_ms";
    const rawStart = sessionStorage.getItem(key);
    if (!rawStart) return;
    const navStart = Number(rawStart);
    if (!Number.isFinite(navStart)) {
      sessionStorage.removeItem(key);
      return;
    }
    const elapsedMs = Math.max(0, performance.now() - navStart);
    sessionStorage.removeItem(key);

    const metricsRef = window as Window & {
      __ecosPerfMetrics?: EcosPerfMetrics;
    };
    if (!metricsRef.__ecosPerfMetrics) {
      metricsRef.__ecosPerfMetrics = {
        playFirstPaintMs: [],
        playProgressSyncMs: [],
        playMountAtMs: null,
      };
    }
    metricsRef.__ecosPerfMetrics.playFirstPaintMs.push(elapsedMs);
    metricsRef.__ecosPerfMetrics.playMountAtMs = performance.now();

    if (process.env.NODE_ENV === "development") {
      console.info("[perf] Play first paint (ms):", Math.round(elapsedMs));
    }
  }, []);

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
    revertLastGuessAfterFailedSync,
    revertWinAfterFailedSync,
    setWon,
    setLost,
    gameId,
  } = useGameStore();

  const { getProgress, saveProgress, removeProgress } = useGameProgressStore();
  const localStoredProgress = getProgress(game.id) ?? null;
  const hasLocalDecisiveProgress =
    (localStoredProgress?.phase === "playing" &&
      (localStoredProgress.guesses?.length ?? 0) > 0) ||
    localStoredProgress?.phase === "won" ||
    localStoredProgress?.phase === "lost";

  const initialDataGameProgress = useMemo((): GameProgressData | undefined => {
    if (isGuest) return undefined;
    if (localStoredProgress) return { progress: localStoredProgress };
    const fromCache = queryClient.getQueryData<GameProgressData>(
      queryKeys.game.progress(game.id)
    );
    return fromCache ?? undefined;
  }, [isGuest, localStoredProgress, queryClient, game.id]);

  const {
    data: serverProgressData,
    isPending: isServerProgressPending,
    isError: isServerProgressError,
  } = useGameProgressById(game.id, {
    enabled: !isGuest,
    initialData: initialDataGameProgress,
  });
  const [loadedProgress, setLoadedProgress] = useState<GameProgress | null>(
    localStoredProgress
  );
  const gameAudioPlayerRef = useRef<AudioPlayerHandle | null>(null);
  /** Evita segundo intento/salto mientras la sync con el servidor está en curso. */
  const syncInFlightRef = useRef(false);
  const lastSkipTapAtRef = useRef(0);
  /** Última partida para la que se ejecutó el bootstrap; al cambiar `game.id` debe repetirse. */
  const bootstrappedGameIdRef = useRef<string | null>(null);
  const lastServerSyncRef = useRef<string | null>(null);

  const resolveAuthoritativeProgress = useCallback(
    (
      localProgress: GameProgress | null,
      serverProgress: GameProgress | null
    ): GameProgress | null => {
      if (!localProgress) return serverProgress;
      if (!serverProgress) return localProgress;

      const localCompleted =
        localProgress.phase === "won" || localProgress.phase === "lost";
      const serverCompleted =
        serverProgress.phase === "won" || serverProgress.phase === "lost";

      if (serverCompleted && !localCompleted) return serverProgress;
      if (localCompleted && !serverCompleted) return localProgress;
      if (serverCompleted && localCompleted) {
        const sLen = serverProgress.guesses?.length ?? 0;
        const lLen = localProgress.guesses?.length ?? 0;
        if (sLen > lLen) return serverProgress;
        if (lLen > sLen) return localProgress;
        return serverProgress;
      }

      return serverProgress.guesses.length >= localProgress.guesses.length
        ? serverProgress
        : localProgress;
    },
    []
  );

  const authoritativeProgress = useMemo(() => {
    if (isGuest) return null;
    const serverProgress = serverProgressData?.progress ?? null;
    return resolveAuthoritativeProgress(localStoredProgress, serverProgress);
  }, [isGuest, serverProgressData, localStoredProgress, resolveAuthoritativeProgress]);

  // Al cambiar de ruta /play/[id] sin desmontar, alinear estado local y permitir re-bootstrap.
  useLayoutEffect(() => {
    lastServerSyncRef.current = null;
    setLoadedProgress(getProgress(game.id) ?? null);
    if (gameId !== game.id) {
      // Evita mostrar estado residual del juego previo mientras se resuelve progreso real.
      startGame(game.id, game.date);
    }
  }, [game.id, game.date, gameId, getProgress, startGame]);

  // Bootstrap inmediato desde caché local para no bloquear con skeleton (se repite por cada `game.id`).
  useEffect(() => {
    if (bootstrappedGameIdRef.current === game.id) return;
    bootstrappedGameIdRef.current = game.id;

    if (localStoredProgress?.phase === "playing" && localStoredProgress.guesses.length > 0) {
      loadProgress(
        game.id,
        game.date,
        localStoredProgress.guesses,
        localStoredProgress.guesses.length + 1
      );
      setLoadedProgress(null);
      return;
    }

    if (localStoredProgress && (localStoredProgress.phase === "won" || localStoredProgress.phase === "lost")) {
      setLoadedProgress(localStoredProgress);
      return;
    }

    if (!isGuest && !hasLocalDecisiveProgress) {
      if (gameId !== game.id || phase === "idle") {
        startGame(game.id, game.date);
      }
      setLoadedProgress(null);
      return;
    }

    if (gameId !== game.id || phase === "idle") {
      startGame(game.id, game.date);
    }
    setLoadedProgress(null);
  }, [
    game.id,
    game.date,
    gameId,
    phase,
    loadProgress,
    localStoredProgress,
    startGame,
    isGuest,
    hasLocalDecisiveProgress,
  ]);

  // Revalidación en background para autenticados: reconcilia sin bloquear la UI.
  useEffect(() => {
    if (isGuest) return;
    if (!serverProgressData) return;

    const serverProgress = serverProgressData.progress ?? null;
    const authoritative = resolveAuthoritativeProgress(localStoredProgress, serverProgress);
    const signature = JSON.stringify({
      phase: authoritative?.phase ?? null,
      guesses: authoritative?.guesses.length ?? 0,
      score: authoritative?.score ?? null,
      correctAttempt: authoritative?.correctAttempt ?? null,
    });
    if (lastServerSyncRef.current === signature) return;
    lastServerSyncRef.current = signature;

    if (typeof window !== "undefined") {
      const metricsRef = window as Window & {
        __ecosPerfMetrics?: EcosPerfMetrics;
      };
      if (!metricsRef.__ecosPerfMetrics) {
        metricsRef.__ecosPerfMetrics = {
          playFirstPaintMs: [],
          playProgressSyncMs: [],
          playMountAtMs: null,
        };
      }
      const mountAt = metricsRef.__ecosPerfMetrics.playMountAtMs;
      const syncElapsed =
        mountAt != null ? Math.max(0, performance.now() - mountAt) : 0;
      metricsRef.__ecosPerfMetrics.playProgressSyncMs.push(syncElapsed);
    }

    if (!authoritative) {
      removeProgress(game.id);
      if (gameId !== game.id || phase === "idle") {
        startGame(game.id, game.date);
      }
      setLoadedProgress(null);
      return;
    }

    saveProgress(authoritative);
    if (authoritative.phase === "playing" && authoritative.guesses.length > 0) {
      loadProgress(
        game.id,
        game.date,
        authoritative.guesses,
        authoritative.guesses.length + 1
      );
      setLoadedProgress(null);
      return;
    }

    if (authoritative.phase === "won" || authoritative.phase === "lost") {
      setLoadedProgress(authoritative);
      return;
    }

    if (gameId !== game.id || phase === "idle") {
      startGame(game.id, game.date);
    }
    setLoadedProgress(null);
  }, [
    game.id,
    game.date,
    gameId,
    isGuest,
    loadProgress,
    localStoredProgress,
    phase,
    removeProgress,
    resolveAuthoritativeProgress,
    saveProgress,
    serverProgressData,
    startGame,
  ]);

  const isStoreGameAligned = gameId === game.id;
  const effectivePhase: GamePhase = isStoreGameAligned ? phase : "idle";
  const effectiveCurrentAttempt = isStoreGameAligned ? currentAttempt : 1;
  const effectiveGuesses = isStoreGameAligned ? guesses : [];
  const effectiveAudioDuration = isStoreGameAligned ? audioDuration : ATTEMPT_DURATIONS[0];
  const effectiveFinalScore = isStoreGameAligned ? finalScore : null;
  const effectiveCorrectAttempt = isStoreGameAligned ? correctAttempt : null;

  useEffect(() => {
    if (isGuest || hasLocalDecisiveProgress) return;
    if (!isServerProgressError) return;
    if (gameId !== game.id || phase === "idle") {
      startGame(game.id, game.date);
    }
    setLoadedProgress(null);
  }, [
    isGuest,
    hasLocalDecisiveProgress,
    isServerProgressError,
    game.id,
    game.date,
    gameId,
    phase,
    startGame,
  ]);

  const handleGuess = useCallback(
    (song: EcosSong) => {
      if (effectivePhase !== "playing") return;
      if (!isGuest && syncInFlightRef.current) return;

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
          colors:
            resolvedTheme === "dark"
              ? [...CONFETTI_COLORS_DARK]
              : [...CONFETTI_COLORS_LIGHT],
        });

        const guessEntry = {
          text: guessText,
          correct: true,
          attemptNumber: effectiveCurrentAttempt,
        };
        addGuess(guessEntry);

        if (isGuest) {
          const { totalPoints } = calculateScore(effectiveCurrentAttempt, 0);
          setWon(effectiveCurrentAttempt, totalPoints);
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
            correctAttempt: effectiveCurrentAttempt,
          });
        } else {
          syncInFlightRef.current = true;
          const optimisticScore = calculateScore(effectiveCurrentAttempt, 0).totalPoints;
          setWon(effectiveCurrentAttempt, optimisticScore);

          void (async () => {
            try {
              const data = await validateGuessMutation.mutateAsync({
                userId,
                gameId: game.id,
                event: "gameCompleted",
                song: {
                  title: game.ecos_songs.title,
                  artist_name: game.ecos_songs.artist_name,
                  cover_url: game.ecos_songs.cover_url,
                },
                request: {
                  gameId: game.id,
                  userId: userId!,
                  attemptNumber: effectiveCurrentAttempt,
                  guessText,
                  songId: song.id,
                  guessArtistName: song.artist_name,
                  guessAlbumTitle: song.album_title ?? undefined,
                  finalize: true,
                },
                optimistic: {
                  type: "completion",
                  won: true,
                  score: optimisticScore,
                  completedProgress: {
                    gameDate: game.date,
                    guesses: [...useGameStore.getState().guesses],
                        correctAttempt: effectiveCurrentAttempt,
                  },
                },
              });
              const serverPoints = data.totalPoints ?? optimisticScore;
              if (serverPoints !== optimisticScore) {
                setWon(effectiveCurrentAttempt, serverPoints);
              }
              saveProgress({
                gameId: game.id,
                gameDate: game.date,
                played: true,
                won: true,
                score: serverPoints,
                title: game.ecos_songs.title,
                artist_name: game.ecos_songs.artist_name,
                cover_url: game.ecos_songs.cover_url ?? undefined,
                guesses: useGameStore.getState().guesses,
                phase: "won",
                correctAttempt: effectiveCurrentAttempt,
              });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : t("saveResultError"));
              revertWinAfterFailedSync();
            } finally {
              syncInFlightRef.current = false;
            }
          })();
        }
      } else {
        if (!isGuest) {
          syncInFlightRef.current = true;

          const guessEntry = {
            text: guessText,
            correct: false,
            correctArtist,
            correctAlbum,
            attemptNumber: effectiveCurrentAttempt,
          };
          addGuess(guessEntry);
          const lostNow = effectiveCurrentAttempt >= maxAttempts;
          if (lostNow) {
            setLost();
          }
          const optimisticGuesses = [...useGameStore.getState().guesses];

          void (async () => {
            try {
              const data = await validateGuessMutation.mutateAsync({
                userId,
                gameId: game.id,
                event: lostNow ? "gameCompleted" : "attemptSaved",
                song: {
                  title: game.ecos_songs.title,
                  artist_name: game.ecos_songs.artist_name,
                  cover_url: game.ecos_songs.cover_url,
                },
                request: {
                  gameId: game.id,
                  userId: userId!,
                  attemptNumber: effectiveCurrentAttempt,
                  guessText,
                  songId: song.id,
                  guessArtistName: song.artist_name,
                  guessAlbumTitle: song.album_title ?? undefined,
                  finalize: effectiveCurrentAttempt >= maxAttempts,
                },
                optimistic: lostNow
                  ? {
                      type: "completion",
                      won: false,
                      score: 0,
                      completedProgress: {
                        gameDate: game.date,
                        guesses: optimisticGuesses,
                      },
                    }
                  : {
                      type: "inProgress",
                      inProgress: {
                        gameId: game.id,
                        gameDate: game.date,
                        guesses: optimisticGuesses,
                        phase: "playing",
                      },
                    },
              });
              const srvA = data.correctArtist ?? correctArtist;
              const srvB = data.correctAlbum ?? correctAlbum;
              if (srvA !== guessEntry.correctArtist || srvB !== guessEntry.correctAlbum) {
                const gs = useGameStore.getState().guesses;
                const last = gs[gs.length - 1];
                if (last && last.text === guessText && !last.correct) {
                  useGameStore.setState({
                    guesses: [
                      ...gs.slice(0, -1),
                      { ...last, correctArtist: srvA, correctAlbum: srvB },
                    ],
                  });
                }
              }
              if (lostNow) {
                saveProgress({
                  gameId: game.id,
                  gameDate: game.date,
                  played: true,
                  won: false,
                  score: 0,
                  title: game.ecos_songs.title,
                  artist_name: game.ecos_songs.artist_name,
                  cover_url: game.ecos_songs.cover_url ?? undefined,
                  guesses: useGameStore.getState().guesses,
                  phase: "lost",
                });
              }
            } catch (error) {
              toast.error(error instanceof Error ? error.message : t("saveResultError"));
              revertLastGuessAfterFailedSync();
            } finally {
              syncInFlightRef.current = false;
            }
          })();
          return;
        }

        const guessEntry = {
          text: guessText,
          correct: false,
          correctArtist,
          correctAlbum,
          attemptNumber: effectiveCurrentAttempt,
        };
        addGuess(guessEntry);

        if (effectiveCurrentAttempt >= maxAttempts) {
          setLost();
          saveProgress({
            gameId: game.id,
            gameDate: game.date,
            played: true,
            won: false,
            // 0 (no null): una derrota es una partida jugada. Con null, homeDayDerived
            // la trata como "no jugada" (completed = played && score !== null).
            score: 0,
            title: game.ecos_songs.title,
            artist_name: game.ecos_songs.artist_name,
            cover_url: game.ecos_songs.cover_url ?? undefined,
            guesses: useGameStore.getState().guesses,
            phase: "lost",
          });
        } else {
          saveProgress({
            gameId: game.id,
            gameDate: game.date,
            played: false,
            won: false,
            score: null,
            guesses: useGameStore.getState().guesses,
            phase: "playing",
          });
        }
      }
    },
    [
      effectivePhase,
      game,
      userId,
      isGuest,
      effectiveCurrentAttempt,
      maxAttempts,
      addGuess,
      setWon,
      setLost,
      saveProgress,
      resolvedTheme,
      revertWinAfterFailedSync,
      revertLastGuessAfterFailedSync,
      validateGuessMutation,
      t,
    ]
  );

  const terminalFromAuthoritative =
    !isGuest &&
    authoritativeProgress &&
    (authoritativeProgress.phase === "won" || authoritativeProgress.phase === "lost")
      ? authoritativeProgress
      : null;

  if (!isGuest && !hasLocalDecisiveProgress && isServerProgressPending) {
    return (
      <div className="relative flex min-h-dvh flex-col bg-background">
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
          <div className="absolute left-1/4 top-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/5 blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 h-64 w-64 translate-x-1/2 translate-y-1/2 rounded-full bg-blue-500/5 blur-[100px]" />
        </div>
        <header className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-border/80 bg-background/95 px-4 pt-safe backdrop-blur-sm">
          <Link
            href="/"
            onClick={navigateBackToHomePlaying}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/80"
            aria-label={tc("back")}
          >
            <span aria-hidden className="material-symbols-outlined text-xl">arrow_back</span>
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
          <div className="flex h-9 w-9 shrink-0" aria-hidden />
        </header>
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-24">
          <span
            className="material-symbols-outlined animate-spin text-3xl text-muted-foreground"
            aria-hidden
          >
            progress_activity
          </span>
          <p className="text-center text-xs text-muted-foreground">{tc("loading")}</p>
        </div>
      </div>
    );
  }

  const isResultView =
    effectivePhase === "won" ||
    effectivePhase === "lost" ||
    (loadedProgress &&
      (loadedProgress.phase === "won" || loadedProgress.phase === "lost")) ||
    terminalFromAuthoritative !== null;

  if (isResultView) {
    const loadedForResult = terminalFromAuthoritative ?? loadedProgress;

    const localHasTerminalResult = effectivePhase === "won" || effectivePhase === "lost";
    const loadedHasTerminalResult =
      loadedForResult?.phase === "won" || loadedForResult?.phase === "lost";
    const loadedGuessesCount = loadedForResult?.guesses.length ?? 0;
    const localGuessesCount = effectiveGuesses.length;
    const localResultLooksRicher =
      localHasTerminalResult &&
      (!loadedHasTerminalResult ||
        localGuessesCount > loadedGuessesCount ||
        (effectivePhase === "won" &&
          effectiveCorrectAttempt != null &&
          (loadedForResult?.correctAttempt ?? null) == null));
    const useLocalResult = localResultLooksRicher;

    const resultPhase = useLocalResult
      ? effectivePhase
      : loadedForResult
        ? loadedForResult.phase
        : effectivePhase;
    const resultCorrectAttempt = useLocalResult
      ? effectiveCorrectAttempt
      : loadedForResult
        ? loadedForResult.correctAttempt ?? null
        : effectiveCorrectAttempt;
    const resultFinalScore = useLocalResult
      ? effectiveFinalScore
      : loadedForResult
        ? loadedForResult.score
        : effectiveFinalScore;
    const resultGuesses = useLocalResult
      ? effectiveGuesses
      : loadedForResult
        ? loadedForResult.guesses
        : effectiveGuesses;

    return (
      <ResultGameView
        game={game}
        resultPhase={resultPhase}
        resultCorrectAttempt={resultCorrectAttempt}
        resultFinalScore={resultFinalScore}
        resultGuesses={resultGuesses}
        isGuest={isGuest}
        maxAttempts={maxAttempts}
      />
    );
  }

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
          onClick={navigateBackToHomePlaying}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/80"
          aria-label={tc("back")}
        >
          <span aria-hidden className="material-symbols-outlined text-xl">arrow_back</span>
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
          onClick={() => {
            gameAudioPlayerRef.current?.stopIfPlaying();
            if (effectivePhase !== "playing") return;
            if (!isGuest && syncInFlightRef.current) return;

            if (!isGuest && userId) {
              const now = Date.now();
              if (now - lastSkipTapAtRef.current < SKIP_BUTTON_DOUBLE_TAP_GUARD_MS) return;
              lastSkipTapAtRef.current = now;

              syncInFlightRef.current = true;
              const lostNow = effectiveCurrentAttempt >= maxAttempts;
              addGuess({
                text: "skipped",
                correct: false,
                attemptNumber: effectiveCurrentAttempt,
              });
              if (lostNow) {
                setLost();
              }
              const optimisticGuesses = [...useGameStore.getState().guesses];
              void (async () => {
                try {
                  await skipAttemptMutation.mutateAsync({
                    userId,
                    gameId: game.id,
                    event: lostNow ? "gameCompleted" : "attemptSaved",
                    song: {
                      title: game.ecos_songs.title,
                      artist_name: game.ecos_songs.artist_name,
                      cover_url: game.ecos_songs.cover_url,
                    },
                    request: {
                      gameId: game.id,
                      attemptNumber: effectiveCurrentAttempt,
                    },
                    optimistic: lostNow
                      ? {
                          type: "completion",
                          won: false,
                          score: 0,
                          completedProgress: {
                            gameDate: game.date,
                            guesses: optimisticGuesses,
                          },
                        }
                      : {
                          type: "inProgress",
                          inProgress: {
                            gameId: game.id,
                            gameDate: game.date,
                            guesses: optimisticGuesses,
                            phase: "playing",
                          },
                        },
                  });
                  if (lostNow) {
                    saveProgress({
                      gameId: game.id,
                      gameDate: game.date,
                      played: true,
                      won: false,
                      score: 0,
                      title: game.ecos_songs.title,
                      artist_name: game.ecos_songs.artist_name,
                      cover_url: game.ecos_songs.cover_url ?? undefined,
                      guesses: useGameStore.getState().guesses,
                      phase: "lost",
                    });
                  }
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t("saveResultError"));
                  revertLastGuessAfterFailedSync();
                } finally {
                  syncInFlightRef.current = false;
                }
              })();
              return;
            }

            const now = Date.now();
            if (now - lastSkipTapAtRef.current < SKIP_BUTTON_DOUBLE_TAP_GUARD_MS) return;
            lastSkipTapAtRef.current = now;

            addGuess({
              text: "skipped",
              correct: false,
              attemptNumber: effectiveCurrentAttempt,
            });
            if (effectiveCurrentAttempt >= maxAttempts) {
              setLost();
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
            } else {
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
          }}
          className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <span aria-hidden className="material-symbols-outlined text-lg">skip_next</span>
          {t("skip")}
        </button>
      </header>

      {/* Espaciador para el header fijo */}
      <div className="h-14 shrink-0" aria-hidden />

      <PlayingGameAudioSection
        game={game}
        audioDuration={effectiveAudioDuration}
        guesses={effectiveGuesses}
        maxAttempts={maxAttempts}
        isGuest={isGuest}
        playerRef={gameAudioPlayerRef}
      >
        <GuessInput
          onGuess={handleGuess}
          disabled={effectivePhase !== "playing"}
          alreadyGuessedTexts={effectiveGuesses.map((g) => g.text)}
        />
        {effectiveGuesses.length > 0 && (
          <PreviousAttempts guesses={effectiveGuesses} />
        )}
      </PlayingGameAudioSection>
      </div>
    </div>
  );
}

