"use client";

import type { QueryClient } from "@tanstack/react-query";
import type {
  GameWithSong,
  PreviousDayGame,
  InProgressProgress,
  TodaysCompletedResult,
} from "@/lib/queries/games";
import type { GameProgress } from "@/lib/store/gameProgressStore";
import {
  markHomeSyncSignal,
  markRecentGameCompleted,
} from "@/lib/consistencySync";
import { queryKeys } from "./queryKeys";
import {
  fetchGameProgressById,
  fetchHomeDayStatusById,
  fetchHomePreviousDaysData,
  fetchHomeTodayData,
} from "./queryFetchers";
import type {
  GameCacheSnapshot,
  GameMutationEvent,
  GameProgressData,
  HomeDayStatusData,
  HomePreviousDaysData,
  HomeTodayData,
  QueryDiagnosticRecord,
  SongSnapshot,
} from "./queryTypes";

/**
 * Parcheado de la caché de TanStack Query alrededor de una partida.
 *
 * Es la parte más delicada del cliente después de `GameClient`: siembra el estado del día,
 * aplica los cambios optimistas al acertar o fallar, y reconcilia lo que devuelve el servidor.
 * Se ha extraído de `queries.ts` tal cual, sin cambiar lógica.
 *
 * Cuidado al tocarlo: varias de estas funciones se llaman desde `onMutate`, así que corren antes
 * de que el servidor conteste y su efecto debe poder revertirse con
 * `takeGameCacheSnapshot`/`restoreGameCacheSnapshot`.
 */

function trackQueryDiagnostic(queryKey: readonly unknown[], event: string) {
  if (process.env.NODE_ENV !== "development") return;
  if (typeof window === "undefined") return;

  const globalRef = window as Window & {
    __ecosQueryDiagnostics?: Record<string, QueryDiagnosticRecord>;
  };
  const key = JSON.stringify(queryKey);
  const map = (globalRef.__ecosQueryDiagnostics ??= {});
  const prev = map[key];
  map[key] = {
    key,
    count: (prev?.count ?? 0) + 1,
    lastEvent: event,
    lastAt: Date.now(),
  };
}

function normalizeCoverUrl(coverUrl: string | null | undefined): string {
  return coverUrl ?? "";
}

function guessCountFromInProgress(
  p: InProgressProgress | null | undefined
): number {
  return p?.guesses?.length ?? 0;
}

/**
 * No sustituir day-status en caché si el nuevo snapshot (p. ej. RSC) trae menos intentos
 * que lo ya sincronizado tras jugar en /play.
 */
export function primeHomeDayStatusCache(
  queryClient: QueryClient,
  previousDays: PreviousDayGame[],
  inProgressByGameId?: Record<string, InProgressProgress>
) {
  for (const day of previousDays) {
    const incomingInProgress = inProgressByGameId?.[day.id] ?? null;
    const existing = queryClient.getQueryData<HomeDayStatusData>(
      queryKeys.home.dayStatus(day.id)
    );

    let resolvedInProgress: InProgressProgress | null = incomingInProgress;
    if (day.played) {
      resolvedInProgress = null;
    } else if (existing?.inProgress) {
      const existingN = guessCountFromInProgress(existing.inProgress);
      const incomingN = guessCountFromInProgress(incomingInProgress);
      if (incomingInProgress == null && existingN > 0) {
        resolvedInProgress = existing.inProgress;
      } else if (existingN > incomingN) {
        resolvedInProgress = existing.inProgress;
      }
    }

    /**
     * Protege contra downgrade por payload mensual stale:
     * si ya teníamos este día como completado y entra "no jugado", mantener completado.
     */
    const keepExistingCompletion = Boolean(existing?.played && !day.played);

    const status: HomeDayStatusData = keepExistingCompletion
      ? {
          gameId: day.id,
          played: true,
          won: existing?.won ?? day.won,
          score: existing?.score ?? day.score,
          title: existing?.title ?? day.title,
          artist_name: existing?.artist_name ?? day.artist_name,
          cover_url: existing?.cover_url ?? day.cover_url,
          inProgress: null,
        }
      : {
          gameId: day.id,
          played: day.played,
          won: day.won,
          score: day.score,
          title: day.title,
          artist_name: day.artist_name,
          cover_url: day.cover_url,
          inProgress: resolvedInProgress,
        };
    queryClient.setQueryData(queryKeys.home.dayStatus(day.id), status);
  }
}

export function applyOptimisticInProgressCaches(
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

export function applyOptimisticCompletionCaches(
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

export function inProgressToGameProgress(
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

export function completionToGameProgress(
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
 * Hidrata cachés de React Query para `/play/[gameId]` con lo ya cargado en el RSC de la home
 * (navegación instantánea para usuarios logueados).
 * Incluye partidas completadas con resumen RSC (guesses vacíos hasta el refetch; `staleTime: 0` en la query).
 */
export function primePlayQueriesFromHomeInitialData(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    prefetchedGamesById: Record<string, GameWithSong>;
    inProgressByGameId?: Record<string, InProgressProgress>;
    todaysGame: GameWithSong | null;
    todaysCompletedResult: TodaysCompletedResult | null;
    previousDays: PreviousDayGame[];
  }
): void {
  const { userId, prefetchedGamesById, inProgressByGameId } = input;
  if (!userId) return;

  for (const [gameId, game] of Object.entries(prefetchedGamesById)) {
    queryClient.setQueryData(queryKeys.game.byId(gameId), game);
  }

  for (const [gameId, inProg] of Object.entries(inProgressByGameId ?? {})) {
    const existing = queryClient.getQueryData<GameProgressData>(
      queryKeys.game.progress(gameId)
    );
    const phase = existing?.progress?.phase;
    if (phase === "won" || phase === "lost") {
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
    if (
      existing?.progress?.phase === "playing" &&
      (existing.progress.guesses?.length ?? 0) > 0
    ) {
      /* Hay partida en curso más rica en caché (p. ej. tras jugar). */
    } else if (
      (existing?.progress?.phase === "won" || existing?.progress?.phase === "lost") &&
      (existing?.progress?.guesses?.length ?? 0) > 0
    ) {
      /* Ya hay resultado completo (p. ej. tras refetch). */
    } else {
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
    if (
      existing?.progress?.phase === "playing" &&
      (existing.progress.guesses?.length ?? 0) > 0
    ) {
      continue;
    }
    if (
      (existing?.progress?.phase === "won" || existing?.progress?.phase === "lost") &&
      (existing?.progress?.guesses?.length ?? 0) > 0
    ) {
      continue;
    }
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

  for (const gameId of Object.keys(prefetchedGamesById)) {
    if (playedOrInProgressIds.has(gameId)) continue;
    const existing = queryClient.getQueryData<GameProgressData>(
      queryKeys.game.progress(gameId)
    );
    if (
      existing?.progress?.phase === "playing" &&
      (existing.progress.guesses?.length ?? 0) > 0
    ) {
      continue;
    }
    if (existing?.progress?.phase === "won" || existing?.progress?.phase === "lost") {
      continue;
    }
    queryClient.setQueryData(queryKeys.game.progress(gameId), { progress: null });
  }
}

/**
 * Tras refetch de day-status, alinea la lista agregada en caché (sin invalidar todo el histórico).
 */
export function patchHomePreviousDaysAllFromDayStatus(
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
    (prev: HomePreviousDaysData | undefined) => {
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
      if (dayStatus.played) {
        delete nextInProgress[gameId];
      } else if (dayStatus.inProgress) {
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
  );

  const monthKey = getMonthKeyForGameFromCaches(queryClient, userId, gameId);
  if (monthKey) {
    queryClient.setQueryData(
      queryKeys.home.previousDays(monthKey, userId),
      (prev: HomePreviousDaysData | undefined) => {
        if (!prev?.previousDays) return prev;
        const mIdx = prev.previousDays.findIndex((d) => d.id === gameId);
        if (mIdx < 0) return prev;
        const nextDays = [...prev.previousDays];
        nextDays[mIdx] = {
          ...nextDays[mIdx],
          played: dayStatus.played,
          won: dayStatus.won,
          score: dayStatus.score,
          title: dayStatus.title,
          artist_name: dayStatus.artist_name,
          cover_url: dayStatus.cover_url,
        };
        const nextInProgress: Record<string, InProgressProgress> = {
          ...(prev.inProgressByGameId ?? {}),
        };
        if (dayStatus.played) {
          delete nextInProgress[gameId];
        } else if (dayStatus.inProgress) {
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
    );
  }
}

/**
 * Refetch granular post-intento: progreso del juego, estado del día, home hoy, mes afectado; parchea agregados.
 */
export async function syncQueriesAfterGameEvent(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    gameId: string;
    event: GameMutationEvent;
  }
) {
  const { userId, gameId, event } = input;

  markHomeSyncSignal(userId, gameId, event);

  await queryClient.fetchQuery({
    queryKey: queryKeys.game.progress(gameId),
    queryFn: () => fetchGameProgressById(gameId),
    staleTime: 0,
  });
  await queryClient.fetchQuery({
    queryKey: queryKeys.home.dayStatus(gameId),
    queryFn: () => fetchHomeDayStatusById(gameId),
    staleTime: 0,
  });

  if (userId) {
    await queryClient.fetchQuery({
      queryKey: queryKeys.home.today(userId),
      queryFn: fetchHomeTodayData,
      staleTime: 0,
    });
  }

  const monthKey = getMonthKeyForGameFromCaches(queryClient, userId, gameId);
  if (userId && monthKey) {
    await queryClient.fetchQuery({
      queryKey: queryKeys.home.previousDays(monthKey, userId),
      queryFn: () => fetchHomePreviousDaysData(monthKey),
      staleTime: 0,
    });
  }

  patchHomePreviousDaysAllFromDayStatus(queryClient, userId, gameId);

  if (event === "gameCompleted") {
    markRecentGameCompleted(userId);
    trackQueryDiagnostic(queryKeys.ranking.all, "syncQueriesAfterGameEvent");
    trackQueryDiagnostic(queryKeys.profile.all, "syncQueriesAfterGameEvent");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.ranking.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.all }),
      userId
        ? queryClient.invalidateQueries({
            queryKey: queryKeys.home.userStats(userId),
          })
        : Promise.resolve(),
    ]);

    await Promise.all([
      queryClient.refetchQueries({
        queryKey: queryKeys.ranking.all,
        type: "active",
      }),
      queryClient.refetchQueries({
        queryKey: queryKeys.profile.all,
        type: "active",
      }),
      userId
        ? queryClient.refetchQueries({
            queryKey: queryKeys.home.userStats(userId),
            type: "active",
          })
        : Promise.resolve(),
    ]);
  }
}

/**
 * Resuelve YYYY-MM del juego para invalidar solo la query mensual afectada,
 * sin disparar refetch de todos los meses prefetcheados en caché.
 */
function getMonthKeyForGameFromCaches(
  queryClient: QueryClient,
  userId: string | null,
  gameId: string
): string | null {
  if (userId) {
    const all = queryClient.getQueryData<HomePreviousDaysData>(
      queryKeys.home.previousDaysAll(userId)
    );
    const fromAll = all?.previousDays?.find((d) => d.id === gameId);
    if (fromAll?.date) return fromAll.date.slice(0, 7);
  }
  const today = userId
    ? queryClient.getQueryData<HomeTodayData>(queryKeys.home.today(userId))
    : undefined;
  if (today?.todaysGame?.id === gameId && today.todaysGame.date) {
    return today.todaysGame.date.slice(0, 7);
  }
  const monthlyEntries = queryClient.getQueriesData<HomePreviousDaysData>({
    queryKey: ["home", "previous-days"],
    exact: false,
  });
  for (const [, data] of monthlyEntries) {
    const hit = data?.previousDays?.find((d) => d.id === gameId);
    if (hit?.date) return hit.date.slice(0, 7);
  }
  return null;
}

/** Alias retrocompatible: sincroniza caché granular tras intento o fin de partida. */
export async function invalidateAfterGameEvent(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    gameId: string;
    event: GameMutationEvent;
  }
) {
  await syncQueriesAfterGameEvent(queryClient, input);
}
