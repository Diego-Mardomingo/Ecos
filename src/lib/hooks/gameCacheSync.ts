"use client";

import type { QueryClient } from "@tanstack/react-query";
import type {
  GameWithSong,
  PreviousDayGame,
  InProgressProgress,
  TodaysCompletedResult,
} from "@/lib/queries/games";
import { isTerminalProgress, type GameProgress } from "@/lib/store/gameProgressStore";
import {
  markHomeSyncSignal,
  markRecentGameCompleted,
} from "@/lib/consistencySync";
import { queryKeys } from "./queryKeys";
import {
  fetchGameProgressById,
  fetchHomeDayStatusById,
  fetchHomeTodayData,
} from "./queryFetchers";
import type {
  GameCacheSnapshot,
  GameMutationEvent,
  GameOptimistic,
  GameProgressData,
  HomeDayStatusData,
  HomePreviousDaysData,
  HomeTodayData,
  SongSnapshot,
} from "./queryTypes";

/**
 * Parcheado de la caché de TanStack Query alrededor de una partida.
 *
 * Es la parte más delicada del cliente después de `GameClient`: siembra el estado del día,
 * aplica los cambios optimistas al acertar o fallar, y reconcilia lo que devuelve el servidor.
 *
 * Cuidado al tocarlo: varias de estas funciones se llaman desde `onMutate`, así que corren antes
 * de que el servidor conteste y su efecto debe poder revertirse con
 * `takeGameCacheSnapshot`/`restoreGameCacheSnapshot`.
 */

function normalizeCoverUrl(coverUrl: string | null | undefined): string {
  return coverUrl ?? "";
}

function applyOptimisticInProgressCaches(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    gameId: string;
    inProgress: InProgressProgress;
    song: SongSnapshot;
  }
) {
  const { userId, gameId, inProgress, song } = input;
  if (!userId) return;

  queryClient.setQueryData(queryKeys.home.dayStatus(gameId), (prev: unknown) => {
    const previous = (prev ?? {}) as Partial<HomeDayStatusData>;
    return {
      gameId,
      played: false,
      won: false,
      score: null,
      title: previous.title ?? song.title,
      artist_name: previous.artist_name ?? song.artist_name,
      cover_url: previous.cover_url ?? normalizeCoverUrl(song.cover_url),
      inProgress,
    } satisfies HomeDayStatusData;
  });

  queryClient.setQueryData(queryKeys.home.today(userId), (prev: unknown) => {
    const previous = (prev ?? {}) as HomeTodayData;
    if (previous.todaysGame?.id !== gameId) return previous;
    return {
      ...previous,
      todaysInProgress: inProgress,
      todaysCompletedResult: null,
    } satisfies HomeTodayData;
  });

  queryClient.setQueryData(queryKeys.game.progress(gameId), {
    progress: inProgressToGameProgress(gameId, inProgress),
  });

  patchHomePreviousDaysAllFromDayStatus(queryClient, userId, gameId);
}

function applyOptimisticCompletionCaches(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    gameId: string;
    won: boolean;
    score: number | null;
    song: SongSnapshot;
    completedProgress?: {
      gameDate?: string;
      guesses?: GameProgress["guesses"];
      correctAttempt?: number;
    };
  }
) {
  const { userId, gameId, won, score, song, completedProgress } = input;
  if (!userId) return;

  queryClient.setQueryData(queryKeys.home.dayStatus(gameId), (prev: unknown) => {
    const previous = (prev ?? {}) as Partial<HomeDayStatusData>;
    return {
      ...previous,
      gameId,
      played: true,
      won,
      score,
      title: song.title,
      artist_name: song.artist_name,
      cover_url: normalizeCoverUrl(song.cover_url),
      inProgress: null,
    } satisfies HomeDayStatusData;
  });

  queryClient.setQueryData(queryKeys.home.today(userId), (prev: unknown) => {
    const previous = (prev ?? {}) as HomeTodayData;
    if (previous.todaysGame?.id !== gameId) return previous;
    return {
      ...previous,
      todaysCompletedResult: {
        title: song.title,
        artist_name: song.artist_name,
        cover_url: normalizeCoverUrl(song.cover_url),
        score: score ?? 0,
        won,
      },
      todaysInProgress: null,
    } satisfies HomeTodayData;
  });

  const prevProgress = queryClient.getQueryData<GameProgressData>(
    queryKeys.game.progress(gameId)
  );
  const prevToday = queryClient.getQueryData<HomeTodayData>(
    queryKeys.home.today(userId)
  );
  const gameDate =
    completedProgress?.gameDate ??
    prevProgress?.progress?.gameDate ??
    (prevToday?.todaysGame?.id === gameId ? prevToday.todaysGame?.date : undefined) ??
    "";
  queryClient.setQueryData(queryKeys.game.progress(gameId), {
    progress: completionToGameProgress(
      gameId,
      gameDate,
      won,
      score,
      song,
      completedProgress?.guesses,
      completedProgress?.correctAttempt
    ),
  });

  patchHomePreviousDaysAllFromDayStatus(queryClient, userId, gameId);
}

/** Aplica el cambio optimista de una jugada, sea de partida en curso o terminada. */
export function applyGameOptimisticCaches(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    gameId: string;
    song: SongSnapshot;
    optimistic: GameOptimistic;
  }
) {
  const { userId, gameId, song, optimistic } = input;
  if (optimistic.type === "completion") {
    applyOptimisticCompletionCaches(queryClient, {
      userId,
      gameId,
      won: optimistic.won,
      score: optimistic.score,
      song,
      completedProgress: optimistic.completedProgress,
    });
  } else {
    applyOptimisticInProgressCaches(queryClient, {
      userId,
      gameId,
      inProgress: optimistic.inProgress,
      song,
    });
  }
}

/**
 * Deja en caché el estado de la partida que ha confirmado el servidor. Normalmente coincide con
 * el optimista y no cambia nada (`setQueryData` conserva la referencia si los datos son iguales);
 * importa cuando el servidor corrige al cliente: otro veredicto, otros aciertos de artista o
 * álbum, u otra puntuación. Sin esto, la caché seguiría diciendo lo que supuso el cliente hasta
 * el refetch, y la reconciliación de `GameClient` podría tomarlo por bueno.
 */
export function applyConfirmedProgressCaches(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    gameId: string;
    song: SongSnapshot;
    progress: GameProgress;
  }
) {
  const { userId, gameId, song, progress } = input;
  applyGameOptimisticCaches(queryClient, {
    userId,
    gameId,
    song,
    optimistic: isTerminalProgress(progress)
      ? {
          type: "completion",
          won: progress.won,
          score: progress.score,
          completedProgress: {
            gameDate: progress.gameDate,
            guesses: progress.guesses,
            correctAttempt: progress.correctAttempt,
          },
        }
      : {
          type: "inProgress",
          inProgress: {
            gameId,
            gameDate: progress.gameDate,
            guesses: progress.guesses,
            phase: "playing",
          },
        },
  });
}

export function takeGameCacheSnapshot(
  queryClient: QueryClient,
  userId: string | null,
  gameId: string
): GameCacheSnapshot {
  return {
    dayStatus: queryClient.getQueryData<HomeDayStatusData>(
      queryKeys.home.dayStatus(gameId)
    ),
    today: userId
      ? queryClient.getQueryData<HomeTodayData>(queryKeys.home.today(userId))
      : undefined,
    progress: queryClient.getQueryData<GameProgressData>(
      queryKeys.game.progress(gameId)
    ),
  };
}

export function restoreGameCacheSnapshot(
  queryClient: QueryClient,
  userId: string | null,
  gameId: string,
  snapshot: GameCacheSnapshot | undefined
) {
  if (!snapshot) return;
  queryClient.setQueryData(queryKeys.home.dayStatus(gameId), snapshot.dayStatus);
  if (userId) {
    queryClient.setQueryData(queryKeys.home.today(userId), snapshot.today);
  }
  queryClient.setQueryData(queryKeys.game.progress(gameId), snapshot.progress);
}

function inProgressToGameProgress(
  gameId: string,
  inProgress: InProgressProgress
): GameProgress {
  return {
    gameId,
    gameDate: inProgress.gameDate,
    played: false,
    won: false,
    score: null,
    guesses: inProgress.guesses.map((g) => ({
      text: g.text,
      correct: g.correct,
      correctArtist: g.correctArtist,
      correctAlbum: g.correctAlbum,
      attemptNumber: g.attemptNumber,
    })),
    phase: "playing",
  };
}

function completionToGameProgress(
  gameId: string,
  gameDate: string,
  won: boolean,
  score: number | null,
  song: SongSnapshot,
  guesses?: GameProgress["guesses"],
  correctAttempt?: number
): GameProgress {
  return {
    gameId,
    gameDate,
    played: true,
    won,
    score: score ?? 0,
    title: song.title,
    artist_name: song.artist_name,
    cover_url: normalizeCoverUrl(song.cover_url),
    guesses: guesses ?? [],
    phase: won ? "won" : "lost",
    correctAttempt: won ? (correctAttempt ?? undefined) : undefined,
  };
}

/**
 * La caché ya tiene de esta partida algo más rico que un resumen: una partida en curso con
 * intentos, o una terminada con su lista de intentos (p. ej. tras jugar o tras el refetch). En
 * ese caso no se pisa con lo que trae el RSC de la home, que llega sin intentos.
 */
function hasRicherProgress(existing: GameProgressData | undefined): boolean {
  const progress = existing?.progress;
  if (!progress || (progress.guesses?.length ?? 0) === 0) return false;
  return progress.phase === "playing" || isTerminalProgress(progress);
}

/**
 * Hidrata cachés de React Query para `/play/[gameId]` con lo ya cargado en el RSC de la home
 * (navegación instantánea para usuarios logueados).
 * Incluye partidas completadas con resumen RSC (guesses vacíos hasta el refetch; `staleTime: 0` en la query).
 */
export function primePlayQueriesFromHomeInitialData(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    /** Solo los ids: las canciones completas ya no las necesita nadie en cliente. */
    prefetchGameIds: string[];
    inProgressByGameId?: Record<string, InProgressProgress>;
    todaysGame: GameWithSong | null;
    todaysCompletedResult: TodaysCompletedResult | null;
    previousDays: PreviousDayGame[];
  }
): void {
  const { userId, prefetchGameIds, inProgressByGameId } = input;
  if (!userId) return;

  for (const [gameId, inProg] of Object.entries(inProgressByGameId ?? {})) {
    const existing = queryClient.getQueryData<GameProgressData>(
      queryKeys.game.progress(gameId)
    );
    if (isTerminalProgress(existing?.progress)) {
      continue;
    }
    const existingN = existing?.progress?.guesses?.length ?? 0;
    const newN = inProg.guesses?.length ?? 0;
    if (existingN > newN) {
      continue;
    }
    queryClient.setQueryData(queryKeys.game.progress(gameId), {
      progress: inProgressToGameProgress(gameId, inProg),
    });
  }

  const { todaysGame, todaysCompletedResult, previousDays } = input;

  /** Partida de hoy completada: seed con resumen RSC; lista de intentos llega en el refetch (staleTime 0). */
  if (todaysGame && todaysCompletedResult) {
    const gameId = todaysGame.id;
    const existing = queryClient.getQueryData<GameProgressData>(
      queryKeys.game.progress(gameId)
    );
    if (!hasRicherProgress(existing)) {
      queryClient.setQueryData(queryKeys.game.progress(gameId), {
        progress: completionToGameProgress(
          gameId,
          todaysGame.date,
          todaysCompletedResult.won,
          todaysCompletedResult.score,
          {
            title: todaysCompletedResult.title,
            artist_name: todaysCompletedResult.artist_name,
            cover_url: todaysCompletedResult.cover_url,
          },
          [],
          undefined
        ),
      });
    }
  }

  for (const day of previousDays) {
    if (!day.played) continue;
    const gameId = day.id;
    const existing = queryClient.getQueryData<GameProgressData>(
      queryKeys.game.progress(gameId)
    );
    if (hasRicherProgress(existing)) continue;
    queryClient.setQueryData(queryKeys.game.progress(gameId), {
      progress: completionToGameProgress(
        gameId,
        day.date,
        day.won,
        day.score,
        {
          title: day.title,
          artist_name: day.artist_name,
          cover_url: day.cover_url,
        },
        [],
        undefined
      ),
    });
  }

  const playedOrInProgressIds = new Set<string>(Object.keys(inProgressByGameId ?? {}));
  if (todaysGame && todaysCompletedResult) {
    playedOrInProgressIds.add(todaysGame.id);
  }
  for (const day of previousDays) {
    if (day.played) {
      playedOrInProgressIds.add(day.id);
    }
  }

  for (const gameId of prefetchGameIds) {
    if (playedOrInProgressIds.has(gameId)) continue;
    const existing = queryClient.getQueryData<GameProgressData>(
      queryKeys.game.progress(gameId)
    );
    // Aquí basta con que esté terminada, aunque sea sin intentos: un resumen vale más que nada.
    if (hasRicherProgress(existing) || isTerminalProgress(existing?.progress)) continue;
    queryClient.setQueryData(queryKeys.game.progress(gameId), { progress: null });
  }
}

/**
 * Lleva el estado de un día (`dayStatus`) al histórico en caché: la fila del día, si está, y su
 * entrada en `inProgressByGameId` (que se apunta aunque el día no esté en la lista).
 */
function patchPreviousDaysBlock(
  prev: HomePreviousDaysData | undefined,
  gameId: string,
  dayStatus: HomeDayStatusData
): HomePreviousDaysData | undefined {
  if (!prev?.previousDays) return prev;
  const idx = prev.previousDays.findIndex((d) => d.id === gameId);

  let nextDays = prev.previousDays;
  if (idx >= 0) {
    nextDays = [...prev.previousDays];
    nextDays[idx] = {
      ...nextDays[idx],
      played: dayStatus.played,
      won: dayStatus.won,
      score: dayStatus.score,
      title: dayStatus.title,
      artist_name: dayStatus.artist_name,
      cover_url: dayStatus.cover_url,
    };
  }
  const nextInProgress: Record<string, InProgressProgress> = {
    ...(prev.inProgressByGameId ?? {}),
  };
  if (!dayStatus.played && dayStatus.inProgress) {
    nextInProgress[gameId] = dayStatus.inProgress;
  } else {
    delete nextInProgress[gameId];
  }
  return {
    ...prev,
    previousDays: nextDays,
    inProgressByGameId: nextInProgress,
  };
}

/**
 * Tras refetch de day-status, alinea la lista agregada en caché (sin invalidar todo el histórico).
 */
function patchHomePreviousDaysAllFromDayStatus(
  queryClient: QueryClient,
  userId: string | null,
  gameId: string
) {
  if (!userId) return;
  const dayStatus = queryClient.getQueryData<HomeDayStatusData>(
    queryKeys.home.dayStatus(gameId)
  );
  if (!dayStatus) return;

  queryClient.setQueryData(
    queryKeys.home.previousDaysAll(userId),
    (prev: HomePreviousDaysData | undefined) => patchPreviousDaysBlock(prev, gameId, dayStatus)
  );
}

/**
 * Sincronización con el servidor después de una jugada ya guardada. Corre en segundo plano: la
 * mutación no la espera (PDATA-01), así que nunca retrasa la siguiente jugada ni puede revertir
 * una que el servidor ya aceptó. No lanza: los fallos de cada refetch ya los registra el
 * `QueryCache`, y la próxima jugada o la vuelta a la home vuelven a pedir lo mismo.
 *
 * Todo en paralelo y solo lo necesario:
 * - progreso de la partida y estado del día; con este último se parchea el histórico en caché
 *   (pedirlo entero otra vez sobraba);
 * - `home.today`, solo si la partida es la de hoy;
 * - al terminar, ranking, perfil y estadísticas: `invalidateQueries` ya vuelve a pedir las que
 *   están activas, así que no hace falta un `refetchQueries` detrás (las pedía dos veces).
 */
export async function syncQueriesAfterGameEvent(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    gameId: string;
    event: GameMutationEvent;
  }
): Promise<void> {
  const { userId, gameId, event } = input;

  markHomeSyncSignal(userId, gameId, event);

  const tasks: Promise<unknown>[] = [
    queryClient.fetchQuery({
      queryKey: queryKeys.game.progress(gameId),
      queryFn: () => fetchGameProgressById(gameId),
      staleTime: 0,
    }),
    queryClient
      .fetchQuery({
        queryKey: queryKeys.home.dayStatus(gameId),
        queryFn: () => fetchHomeDayStatusById(gameId),
        staleTime: 0,
      })
      .then(() => patchHomePreviousDaysAllFromDayStatus(queryClient, userId, gameId)),
  ];

  if (userId) {
    const today = queryClient.getQueryData<HomeTodayData>(queryKeys.home.today(userId));
    if (today?.todaysGame?.id === gameId) {
      tasks.push(
        queryClient.fetchQuery({
          queryKey: queryKeys.home.today(userId),
          queryFn: fetchHomeTodayData,
          staleTime: 0,
        })
      );
    }
  }

  if (event === "gameCompleted") {
    markRecentGameCompleted(userId);
    tasks.push(
      queryClient.invalidateQueries({ queryKey: queryKeys.ranking.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.all })
    );
    if (userId) {
      tasks.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.home.userStats(userId) })
      );
    }
  }

  await Promise.allSettled(tasks);
}
