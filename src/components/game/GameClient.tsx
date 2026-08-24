"use client";

import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useState,
  useRef,
  useMemo,
  useId,
  memo,
  type ReactNode,
  type RefObject,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";
import Image from "next/image";
import confetti from "canvas-confetti";
import { useTheme } from "next-themes";
import { calculateScore } from "@/lib/scoring";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/audio-player/AudioPlayer";
import { GuessInput } from "@/components/guess-input/GuessInput";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSkipAttemptMutation,
  useValidateGuessMutation,
  useReportGameMutation,
  useGameProgressById,
  queryKeys,
  type GameProgressData,
  type ReportGameInput,
} from "@/lib/hooks/queries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { artistsMatch } from "@/lib/artist-match";
import {
  ATTEMPT_DURATIONS,
  useGameStore,
  type GuessEntry,
  type GamePhase,
} from "@/lib/store/gameStore";
import { useGameProgressStore, type GameProgress } from "@/lib/store/gameProgressStore";
import type { GameWithSong } from "@/lib/queries/games";
import type { EcosSong } from "@/components/guess-input/GuessInput";
import { releaseYearFromReleaseDate } from "@/lib/song-display";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import {
  PLAY_FROM_HOME_STORAGE_KEY,
  useNavigateBackToHome,
} from "@/lib/navigation/useNavigateBackToHome";
import { PLAY_SKELETON_VARIANT_KEY } from "@/lib/navigation/playSkeletonStorage";
import { PLAY_NAVIGATION_END_EVENT } from "@/lib/navigation/playNavigationEvents";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";

/** Duración máxima del preview en pantalla de resultado (segundos completos) */
const FULL_PREVIEW_SECONDS = 30;
/** Ventana corta para ignorar dobles taps accidentales en “Saltar intento”. */
const SKIP_BUTTON_DOUBLE_TAP_GUARD_MS = 500;
/** Perímetro del anillo de progreso (2πr con r=80), para el dash del SVG. */
const RING_CIRCUMFERENCE = 502.65;

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
                {audioLoaded ? (
                  <span aria-hidden
                    className="material-symbols-outlined text-xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    {audioPlaying ? "stop" : "play_arrow"}
                  </span>
                ) : (
                  <span aria-hidden className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
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
        youtubeId={song.youtube_id ?? ""}
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
            <span aria-hidden
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
            {t(GUESS_LABEL_KEYS[labelKey] as string)}
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
                    <span aria-hidden
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
