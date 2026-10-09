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
import { useTheme } from "next-themes";
import { calculateScore } from "@/lib/scoring";
import { type AudioPlayerHandle } from "@/components/audio-player/AudioPlayer";
import { GuessInput } from "@/components/guess-input/GuessInput";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  applyConfirmedProgressCaches,
  fetchFreshGameProgress,
  useSkipAttemptMutation,
  useValidateGuessMutation,
  useGameProgressById,
  queryKeys,
  type GameProgressData,
} from "@/lib/hooks/queries";
import { evaluateGuess } from "@/lib/guess-match";
import { prefetchGameAudio } from "@/lib/audio/audioStore";
import {
  ATTEMPT_DURATIONS,
  SKIPPED_GUESS_TEXT,
  useGameStore,
  type GamePhase,
  type GuessEntry,
} from "@/lib/store/gameStore";
import {
  isTerminalProgress,
  useGameProgressStore,
  type GameProgress,
} from "@/lib/store/gameProgressStore";
import type { GameWithSong } from "@/lib/queries/games";
import type { EcosSong } from "@/components/guess-input/GuessInput";
import { toast } from "sonner";
import { m } from "framer-motion";
import { useRouter } from "@/i18n/navigation";
import { PLAY_FROM_HOME_STORAGE_KEY } from "@/lib/navigation/useNavigateBackToHome";
import { PLAY_SKELETON_VARIANT_KEY } from "@/lib/navigation/playSkeletonStorage";
import { PLAY_NAVIGATION_END_EVENT } from "@/lib/navigation/playNavigationEvents";
import { PreviousAttempts } from "@/components/game/GameAttemptsList";
import { PlayingGameAudioSection } from "@/components/game/GameAudioSection";
import { ResultGameView } from "@/components/game/GameResultScreen";
import { GameBackdrop } from "@/components/game/GameBackdrop";
import { GameHeader } from "@/components/game/GameHeader";
import {
  confirmMove,
  lostProgress,
  nonWinningOptimistic,
  playingProgress,
  songSnapshot,
  wonOptimistic,
  wonProgress,
  type ServerMoveResult,
} from "@/components/game/gameProgressSnapshots";

/** Ventana corta para ignorar dobles taps accidentales en “Saltar intento”. */
const SKIP_BUTTON_DOUBLE_TAP_GUARD_MS = 500;
const CONFETTI_COLORS_DARK = ["#2bee79", "#ffffff", "#0a2015"] as const;
const CONFETTI_COLORS_LIGHT = ["#059669", "#ffffff", "#f8fafc"] as const;

interface Props {
  game: GameWithSong;
  userId: string | null; // null = invitado
}

/**
 * `canvas-confetti` se carga aquí y no arriba: solo se usa al acertar, así que como import
 * estático viajaba en el chunk inicial de /play para algo que la mayoría de las cargas no llega a
 * ejecutar. Va sin await para no retrasar nada de lo que viene después —la animación es adorno,
 * el resto es el estado de la partida— y con catch vacío porque quedarse sin confeti no es un
 * error que merezca molestar al usuario.
 */
function launchConfetti(resolvedTheme: string | undefined) {
  void import("canvas-confetti")
    .then(({ default: confetti }) => {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors:
          resolvedTheme === "dark" ? [...CONFETTI_COLORS_DARK] : [...CONFETTI_COLORS_LIGHT],
      });
    })
    .catch(() => {
      /* sin confeti; la partida sigue */
    });
}

/**
 * Entre el progreso guardado en este dispositivo y el del servidor, cuál manda al cargar la
 * partida: la terminada antes que la que sigue en curso, y si no, la que tenga más intentos.
 */
function resolveAuthoritativeProgress(
  localProgress: GameProgress | null,
  serverProgress: GameProgress | null
): GameProgress | null {
  if (!localProgress) return serverProgress;
  if (!serverProgress) return localProgress;

  const localCompleted = isTerminalProgress(localProgress);
  const serverCompleted = isTerminalProgress(serverProgress);

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
}

/**
 * Clave del aviso cuando una jugada no se ha podido guardar. Nunca el texto crudo del servidor,
 * que llega en inglés («Unauthorized», «Failed to fetch»…) (UX-05).
 */
function failedMoveMessageKey(
  error: unknown,
  decisive: boolean
): "sessionExpiredError" | "networkError" | "saveResultError" | "saveAttemptError" {
  if (error instanceof ApiError && error.status === 401) return "sessionExpiredError";
  // `fetch` rechaza con TypeError cuando no hay red o se corta la conexión.
  if (error instanceof TypeError) return "networkError";
  return decisive ? "saveResultError" : "saveAttemptError";
}

/**
 * Cuerpo de cada envío de la cola de jugadas de `GameClient` (ver `enqueueSubmit`). Vive fuera del
 * componente porque el React Compiler no admite `try` sin `catch` (`try/finally`) y, si lo
 * encuentra dentro, deja sin compilar `GameClient` entero.
 */
async function runQueuedMove(
  isStale: () => boolean,
  submit: () => Promise<ServerMoveResult>,
  onAccepted: (server: ServerMoveResult) => Promise<void> | void,
  onFail: (error: unknown) => void,
  done: () => void
) {
  try {
    if (isStale()) return;
    let server: ServerMoveResult;
    try {
      server = await submit();
    } catch (error) {
      onFail(error);
      return;
    }
    try {
      await onAccepted(server);
    } catch (error) {
      console.error("[partida] reconciliando una jugada ya guardada:", error);
    }
  } finally {
    done();
  }
}

export function GameClient({ game, userId }: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const isGuest = !userId;
  const validateGuessMutation = useValidateGuessMutation();
  const skipAttemptMutation = useSkipAttemptMutation();

  useEffect(() => {
    router.prefetch("/");
    router.prefetch("/ranking");
  }, [router]);

  // El MP3 empieza a bajar en cuanto monta la partida, sin esperar a `/api/game-progress` (el
  // autenticado sin progreso local enseña un spinner hasta que llega, y el reproductor no monta
  // antes). Solo efecto externo, sin estado: `audioStore` es idempotente, comparte la descarga con
  // el reproductor cuando monta y respeta el ahorro de datos.
  const hasAudio = !!game.ecos_songs.preview_url;
  useEffect(() => {
    if (hasAudio) prefetchGameAudio(game.id, "página de partida");
  }, [game.id, hasAudio]);

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

  const {
    phase,
    maxAttempts,
    guesses,
    audioDuration,
    finalScore,
    correctAttempt,
    startGame,
    loadProgress,
    setSnapshot,
    addGuess,
    patchGuess,
    setWon,
    setLost,
    gameId,
  } = useGameStore();

  const getProgress = useGameProgressStore((s) => s.getProgress);
  const saveProgress = useGameProgressStore((s) => s.saveProgress);
  const removeProgress = useGameProgressStore((s) => s.removeProgress);
  /*
   * Con selector y no con `getProgress(game.id)`: `getProgress` nunca cambia de identidad, así que
   * el React Compiler memoizaría su resultado por `[getProgress, game.id]` y el progreso guardado
   * se quedaría viejo tras cada jugada.
   */
  const localStoredProgress = useGameProgressStore((s) => s.byGameId[game.id]) ?? null;
  const hasLocalDecisiveProgress =
    (localStoredProgress?.phase === "playing" &&
      (localStoredProgress.guesses?.length ?? 0) > 0) ||
    isTerminalProgress(localStoredProgress);

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
  const lastSkipTapAtRef = useRef(0);
  /** Última partida para la que se ejecutó el bootstrap; al cambiar `game.id` debe repetirse. */
  const bootstrappedGameIdRef = useRef<string | null>(null);
  const lastServerSyncRef = useRef<string | null>(null);

  /**
   * Cola de envíos del jugador autenticado (PDATA-01). Cada jugada se pinta al instante y su
   * petición sale cuando ha contestado la anterior: en serie, porque el servidor numera los
   * intentos según los que ya tiene guardados.
   *
   * Antes, mientras una jugada se sincronizaba (varios segundos), cualquier otro intento o salto
   * se descartaba sin avisar. Ahora se encola.
   */
  const submitQueueRef = useRef<Promise<void>>(Promise.resolve());
  /**
   * Generación de la cola por partida. Sube cuando una jugada falla o cuando el servidor obliga a
   * recargar la partida: las jugadas que esperaban detrás ya no son válidas y se descartan sin
   * enviarse (la pantalla ya ha vuelto al último estado bueno).
   */
  const queueEpochRef = useRef<Record<string, number>>({});
  /**
   * Envíos sin terminar por partida. Es estado, no ref, porque la reconciliación con el servidor
   * tiene que esperar a que llegue a cero y volver a mirar entonces.
   */
  const [pendingByGame, setPendingByGame] = useState<Record<string, number>>({});
  const hasPendingSubmits = (pendingByGame[game.id] ?? 0) > 0;

  /** Arranca la partida en el store si todavía no está en esta. */
  const ensureGameStarted = useCallback(() => {
    const state = useGameStore.getState();
    if (state.gameId !== game.id || state.phase === "idle") {
      startGame(game.id, game.date);
    }
  }, [game.id, game.date, startGame]);

  const authoritativeProgress = useMemo(() => {
    if (isGuest) return null;
    const serverProgress = serverProgressData?.progress ?? null;
    return resolveAuthoritativeProgress(localStoredProgress, serverProgress);
  }, [isGuest, serverProgressData, localStoredProgress]);

  /*
   * Los efectos de reconciliación de abajo llaman a `setLoadedProgress` de forma síncrona y la
   * regla `react-hooks/set-state-in-effect` lo marca. Estuvo oculto hasta oct. 2026 porque un
   * `try/finally` dejaba `GameClient` sin analizar (ni por el lint ni por el compilador). Se
   * silencia línea a línea para no tocar el flujo invitado/autenticado al activar el compilador;
   * pasar `loadedProgress` a estado derivado es un cambio aparte que exige probar ambas ramas.
   * Silenciar esta regla no hace que el compilador se salte el componente (solo lo hacen
   * `rules-of-hooks` y `exhaustive-deps`).
   */

  // Al cambiar de ruta /play/[id] sin desmontar, alinear estado local y permitir re-bootstrap.
  useLayoutEffect(() => {
    lastServerSyncRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver nota de reconciliación
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ver nota de reconciliación
      setLoadedProgress(null);
      return;
    }

    if (isTerminalProgress(localStoredProgress)) {
      setLoadedProgress(localStoredProgress);
      return;
    }

    ensureGameStarted();
    setLoadedProgress(null);
  }, [game.id, game.date, loadProgress, localStoredProgress, ensureGameStarted]);

  // Revalidación en background para autenticados: reconcilia sin bloquear la UI.
  useEffect(() => {
    if (isGuest) return;
    if (!serverProgressData) return;
    /**
     * Con jugadas sin confirmar, la caché va por detrás de lo que se ve (las que esperan en cola
     * aún no han aplicado su cambio optimista) y aplicarla quitaría de la pantalla jugadas que
     * siguen en camino. Se reconcilia cuando la cola se vacía: este efecto depende de
     * `hasPendingSubmits` y vuelve a correr entonces.
     */
    if (hasPendingSubmits) return;

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

    if (!authoritative) {
      removeProgress(game.id);
      ensureGameStarted();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ver nota de reconciliación
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

    if (isTerminalProgress(authoritative)) {
      setLoadedProgress(authoritative);
      return;
    }

    ensureGameStarted();
    setLoadedProgress(null);
  }, [
    game.id,
    game.date,
    isGuest,
    hasPendingSubmits,
    loadProgress,
    localStoredProgress,
    removeProgress,
    saveProgress,
    serverProgressData,
    ensureGameStarted,
  ]);

  const isStoreGameAligned = gameId === game.id;
  const effectivePhase: GamePhase = isStoreGameAligned ? phase : "idle";
  const effectiveAudioDuration = isStoreGameAligned ? audioDuration : ATTEMPT_DURATIONS[0];
  const effectiveGuesses = isStoreGameAligned ? guesses : [];
  const effectiveFinalScore = isStoreGameAligned ? finalScore : null;
  const effectiveCorrectAttempt = isStoreGameAligned ? correctAttempt : null;

  useEffect(() => {
    if (isGuest || hasLocalDecisiveProgress) return;
    if (!isServerProgressError) return;
    ensureGameStarted();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver nota de reconciliación
    setLoadedProgress(null);
  }, [isGuest, hasLocalDecisiveProgress, isServerProgressError, ensureGameStarted]);

  /** Estado de la partida si es esta la que está en el store; si no, `null`. */
  const playingStateNow = () => {
    const state = useGameStore.getState();
    if (state.gameId !== game.id || state.phase !== "playing") return null;
    return state;
  };

  // ------------------------------------------------------------------------------------------
  // Invitado: todo local, no hay nada que sincronizar.
  // ------------------------------------------------------------------------------------------

  /**
   * Registra un intento que no gana, en modo invitado.
   *
   * Era el mismo bloque en la rama de fallo de `handleGuess` y en el botón de saltar; la única
   * diferencia entre ambos era la entrada del intento.
   */
  const applyGuestAttempt = (entry: GuessEntry) => {
    addGuess(entry);
    if (entry.attemptNumber >= maxAttempts) {
      setLost();
      // Se lee después de setLost, como hacían los dos sitios originales.
      saveProgress(lostProgress({ game, guesses: useGameStore.getState().guesses }));
    } else {
      saveProgress(playingProgress({ game, guesses: useGameStore.getState().guesses }));
    }
  };

  const applyGuestWin = (entry: GuessEntry) => {
    addGuess(entry);
    const { totalPoints } = calculateScore(entry.attemptNumber, 0);
    setWon(entry.attemptNumber, totalPoints);
    saveProgress(
      wonProgress({
        game,
        score: totalPoints,
        guesses: useGameStore.getState().guesses,
        correctAttempt: entry.attemptNumber,
      })
    );
  };

  // ------------------------------------------------------------------------------------------
  // Autenticado: se pinta al momento y se envía en cola.
  // ------------------------------------------------------------------------------------------

  const changePending = (gid: string, delta: number) => {
    setPendingByGame((prev) => ({ ...prev, [gid]: Math.max(0, (prev[gid] ?? 0) + delta) }));
  };

  const bumpQueueEpoch = (gid: string) => {
    queueEpochRef.current[gid] = (queueEpochRef.current[gid] ?? 0) + 1;
  };

  /**
   * Encola el envío de una jugada. `submit` es la petición; si falla (el servidor no la ha
   * aceptado, o no se sabe porque se cortó la red) se llama a `onFail`. Un error **después** de
   * que el servidor la aceptara no la revierte nunca: se registra y la reconciliación lo corrige.
   */
  const enqueueSubmit = (
    gid: string,
    submit: () => Promise<ServerMoveResult>,
    onAccepted: (server: ServerMoveResult) => Promise<void> | void,
    onFail: (error: unknown) => void
  ) => {
    const epoch = queueEpochRef.current[gid] ?? 0;
    changePending(gid, 1);
    submitQueueRef.current = submitQueueRef.current.then(() =>
      runQueuedMove(
        () => (queueEpochRef.current[gid] ?? 0) !== epoch,
        submit,
        onAccepted,
        onFail,
        () => changePending(gid, -1)
      )
    );
  };

  /** Deja la partida exactamente como la tiene el servidor (store, progreso local y resultado). */
  const adoptServerProgress = (moveGame: GameWithSong, progress: GameProgress | null) => {
    if (!progress) {
      removeProgress(moveGame.id);
      startGame(moveGame.id, moveGame.date);
      setLoadedProgress(null);
      return;
    }
    saveProgress(progress);
    setSnapshot(moveGame.id, moveGame.date, progress);
    setLoadedProgress(isTerminalProgress(progress) ? progress : null);
  };

  /** Lo que se hace con la respuesta del servidor a una jugada aceptada. */
  const reconcileAcceptedMove = async (
    moveGame: GameWithSong,
    moveUserId: string,
    entry: GuessEntry,
    optimisticScore: number | null,
    optimisticGuesses: GuessEntry[],
    server: ServerMoveResult
  ) => {
    const isCurrentGame = () => useGameStore.getState().gameId === moveGame.id;
    const baseGuesses = isCurrentGame() ? useGameStore.getState().guesses : optimisticGuesses;
    const result = confirmMove({
      game: moveGame,
      previousGuesses: baseGuesses.filter((g) => g.attemptNumber < entry.attemptNumber),
      entry,
      optimisticScore,
      server,
    });

    if (result.kind === "adopt-server") {
      // Lo que quede en cola se calculó sobre una partida que no es la del servidor.
      bumpQueueEpoch(moveGame.id);
      const fresh = await fetchFreshGameProgress(queryClient, moveGame.id).catch(() => null);
      if (fresh && isCurrentGame()) adoptServerProgress(moveGame, fresh.progress);
      return;
    }

    const { progress } = result;
    saveProgress(progress);
    applyConfirmedProgressCaches(queryClient, {
      userId: moveUserId,
      gameId: moveGame.id,
      song: songSnapshot(moveGame),
      progress,
    });
    if (!isCurrentGame()) return;

    if (result.verdictChanged) {
      // El servidor dice otra cosa que el cliente sobre si era la canción: lo que se ve pasa a
      // ser lo guardado, y lo que se jugara detrás ya no tiene sentido.
      bumpQueueEpoch(moveGame.id);
      setSnapshot(moveGame.id, moveGame.date, progress);
      setLoadedProgress(isTerminalProgress(progress) ? progress : null);
      return;
    }

    const { correctArtist, correctAlbum } = result.entry;
    if (correctArtist !== entry.correctArtist || correctAlbum !== entry.correctAlbum) {
      patchGuess(entry.attemptNumber, { correctArtist, correctAlbum });
    }
    if (progress.phase === "won" && progress.score !== useGameStore.getState().finalScore) {
      setWon(entry.attemptNumber, progress.score ?? 0);
    }
  };

  /** Una jugada que el servidor no ha aceptado: aviso, y la partida vuelve a antes de ella. */
  const handleFailedMove = (
    moveGame: GameWithSong,
    entry: GuessEntry,
    decisive: boolean,
    error: unknown
  ) => {
    bumpQueueEpoch(moveGame.id);
    toast.error(t(failedMoveMessageKey(error, decisive)));
    const state = useGameStore.getState();
    if (state.gameId === moveGame.id) {
      setSnapshot(moveGame.id, moveGame.date, {
        guesses: state.guesses.filter((g) => g.attemptNumber < entry.attemptNumber),
        phase: "playing",
        score: null,
      });
    }
    // Si el servidor sí la guardó y lo que se perdió fue la respuesta, el refetch la trae de
    // vuelta y la reconciliación la vuelve a pintar.
    void queryClient.invalidateQueries({ queryKey: queryKeys.game.progress(moveGame.id) });
  };

  /**
   * Jugada del usuario autenticado: intento (`songId`) o salto (`songId === null`). Acierto,
   * fallo y salto comparten aquí el mismo camino; antes había uno para el acierto y otro para el
   * resto, con la petición a `validate-guess` escrita dos veces.
   */
  const playAuthenticatedMove = (entry: GuessEntry, songId: string | null) => {
    if (!userId) return;
    const moveGame = game;
    const attempt = entry.attemptNumber;
    const decisive = entry.correct || attempt >= maxAttempts;

    addGuess(entry);
    let optimisticScore: number | null = null;
    if (entry.correct) {
      optimisticScore = calculateScore(attempt, 0).totalPoints;
      setWon(attempt, optimisticScore);
    } else if (decisive) {
      setLost();
    }
    const optimisticGuesses = [...useGameStore.getState().guesses];

    const base = {
      userId,
      gameId: moveGame.id,
      event: decisive ? ("gameCompleted" as const) : ("attemptSaved" as const),
      song: songSnapshot(moveGame),
      optimistic:
        optimisticScore != null
          ? wonOptimistic({
              game: moveGame,
              score: optimisticScore,
              guesses: optimisticGuesses,
              correctAttempt: attempt,
            })
          : nonWinningOptimistic({ game: moveGame, lostNow: decisive, guesses: optimisticGuesses }),
    };

    enqueueSubmit(
      moveGame.id,
      () =>
        songId
          ? validateGuessMutation.mutateAsync({
              ...base,
              request: {
                gameId: moveGame.id,
                userId,
                attemptNumber: attempt,
                guessText: entry.text,
                songId,
              },
            })
          : skipAttemptMutation.mutateAsync({
              ...base,
              request: { gameId: moveGame.id, attemptNumber: attempt },
            }),
      (server) =>
        reconcileAcceptedMove(
          moveGame,
          userId,
          entry,
          optimisticScore,
          optimisticGuesses,
          server
        ),
      (error) => handleFailedMove(moveGame, entry, decisive, error)
    );
  };

  const handleGuess = (song: EcosSong) => {
    const state = playingStateNow();
    if (!state) return;
    const attempt = state.currentAttempt;

    const guessText = `${song.title} - ${song.artist_name}`;
    // Misma regla que /api/validate-guess (src/lib/guess-match.ts).
    const { correct, correctArtist, correctAlbum } = evaluateGuess(song, game.ecos_songs);

    if (correct) {
      launchConfetti(resolvedTheme);
      const entry: GuessEntry = { text: guessText, correct: true, attemptNumber: attempt };
      if (isGuest) applyGuestWin(entry);
      else playAuthenticatedMove(entry, song.id);
      return;
    }

    const entry: GuessEntry = {
      text: guessText,
      correct: false,
      correctArtist,
      correctAlbum,
      attemptNumber: attempt,
    };
    if (isGuest) applyGuestAttempt(entry);
    else playAuthenticatedMove(entry, song.id);
  };

  const handleSkip = () => {
    gameAudioPlayerRef.current?.stopIfPlaying();
    const state = playingStateNow();
    if (!state) return;

    // El guard de doble tap va antes de bifurcar: aplica igual a invitado y autenticado.
    const now = Date.now();
    if (now - lastSkipTapAtRef.current < SKIP_BUTTON_DOUBLE_TAP_GUARD_MS) return;
    lastSkipTapAtRef.current = now;

    const skipEntry: GuessEntry = {
      text: SKIPPED_GUESS_TEXT,
      correct: false,
      attemptNumber: state.currentAttempt,
    };

    if (isGuest) applyGuestAttempt(skipEntry);
    else playAuthenticatedMove(skipEntry, null);
  };

  const terminalFromAuthoritative =
    !isGuest && isTerminalProgress(authoritativeProgress) ? authoritativeProgress : null;

  if (!isGuest && !hasLocalDecisiveProgress && isServerProgressPending) {
    return (
      <div className="relative flex min-h-dvh flex-col bg-background">
        <GameBackdrop />
        <GameHeader game={game} />
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-24">
          <span
            className="material-symbols-outlined animate-spin text-3xl text-brand"
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
    isTerminalProgress(loadedProgress) ||
    terminalFromAuthoritative !== null;

  if (isResultView) {
    const loadedForResult = terminalFromAuthoritative ?? loadedProgress;

    const localHasTerminalResult = effectivePhase === "won" || effectivePhase === "lost";
    const loadedHasTerminalResult = isTerminalProgress(loadedForResult);
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
      <GameBackdrop />

      <div className="relative z-10 flex flex-col">
      <GameHeader
        game={game}
        action={
          <m.button
            type="button"
            onClick={handleSkip}
            whileTap={{ scale: 0.92 }}
            // El pseudo-elemento amplía la zona táctil a 44 px de alto sin cambiar el aspecto
            // (el botón mide 40) (UX-12).
            className="group relative flex h-10 items-center gap-1 rounded-full border border-border bg-card/70 pl-3 pr-2.5 text-sm font-semibold text-muted-foreground transition-colors before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[''] hover:border-brand/40 hover:text-foreground"
          >
            {t("skip")}
            <span aria-hidden className="material-symbols-outlined text-xl transition-transform duration-200 group-hover:translate-x-0.5 group-active:translate-x-1">
              skip_next
            </span>
          </m.button>
        }
      />

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
