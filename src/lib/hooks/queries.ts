"use client";

import {
  useMutation,
  useQuery,
  useQueries,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  GameWithSong,
  PreviousDayGame,
  InProgressProgress,
  TodaysCompletedResult,
} from "@/lib/queries/games";
import type { GameProgress } from "@/lib/store/gameProgressStore";

export type { InProgressProgress, TodaysCompletedResult };
import type { UserStats } from "@/lib/queries/users";

/** Home «today» / «previous-days»: ventana corta para volver desde otras rutas sin refetch constante. */
export const HOME_TODAY_STALE_MS = 3 * 60 * 1000;
export const HOME_PREVIOUS_DAYS_STALE_MS = 3 * 60 * 1000;
/** Muchas claves mensuales: evitar el gcTime global corto (10 min) para no descartar el histórico prefetch. */
export const HOME_PREVIOUS_DAYS_GC_MS = 24 * 60 * 60 * 1000;
/** Estado por día en la lista: alineado con home; evita refetch al expandir mes. */
export const HOME_DAY_STATUS_STALE_MS = 3 * 60 * 1000;
/** Ranking social: fresco, pero evitando refetch excesivo al navegar entre tabs. */
export const RANKING_STALE_MS = 2 * 60 * 1000;
/** Perfil: datos de usuario relativamente estables durante una sesión. */
export const PROFILE_STALE_MS = 3 * 60 * 1000;

/** Segmento estable en query keys para invitado vs usuario autenticado. */
export function homeSessionSegment(userId: string | null): string {
  return userId ?? "guest";
}

export const queryKeys = {
  home: {
    all: (userId: string | null) =>
      ["home", "all", homeSessionSegment(userId)] as const,
    today: (userId: string | null) =>
      ["home", "today", homeSessionSegment(userId)] as const,
    previousDaysAll: (userId: string | null) =>
      ["home", "previous-days", "all", homeSessionSegment(userId)] as const,
    previousDays: (monthKey: string, userId: string | null) =>
      ["home", "previous-days", monthKey, homeSessionSegment(userId)] as const,
    dayStatus: (gameId: string) => ["home", "day-status", gameId] as const,
    userStats: (userId: string | null) =>
      ["home", "user-stats", userId ?? "guest"] as const,
  },
  game: {
    all: ["game"] as const,
    byId: (id: string) => ["game", id] as const,
    progress: (id: string) => ["game-progress", id] as const,
  },
  ranking: {
    all: ["ranking"] as const,
    period: (period: string) => ["ranking", "period", period] as const,
    historySummaries: (granularity: string) =>
      ["ranking", "history", "summaries", granularity] as const,
    historyDetail: (granularity: string, anchor: string) =>
      ["ranking", "history", "detail", granularity, anchor] as const,
  },
  profile: {
    all: ["profile"] as const,
    section: (section: "core" | "stats", userId: string | null) =>
      ["profile", "section", section, homeSessionSegment(userId)] as const,
  },
  search: (q: string) => ["search", q] as const,
};

export interface RankingStatsPeriod {
  points: number;
  rank: number | null;
}

export interface HomeData {
  todaysGame: GameWithSong | null;
  previousDays: PreviousDayGame[];
  userStats: UserStats | null;
  userId: string | null;
  inProgressByGameId?: Record<string, InProgressProgress>;
  todaysCompletedResult?: TodaysCompletedResult | null;
  rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
  rankingStats?: {
    global: RankingStatsPeriod;
    weekly: RankingStatsPeriod;
    monthly: RankingStatsPeriod;
  };
}

export interface HomeTodayData {
  todaysGame: GameWithSong | null;
  todaysCompletedResult: TodaysCompletedResult | null;
  todaysInProgress: InProgressProgress | null;
  userId: string | null;
}

export interface HomePreviousDaysData {
  previousDays: PreviousDayGame[];
  userId: string | null;
  month?: string;
  nextMonth?: string | null;
  hasMoreOlder?: boolean;
  inProgressByGameId?: Record<string, InProgressProgress>;
}

export interface HomeUserStatsData {
  userStats: UserStats | null;
  rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
  rankingStats?: {
    global: RankingStatsPeriod;
    weekly: RankingStatsPeriod;
    monthly: RankingStatsPeriod;
  };
  userId: string | null;
}

export interface HomeDayStatusData {
  gameId: string;
  played: boolean;
  won: boolean;
  score: number | null;
  title: string;
  artist_name: string;
  cover_url: string;
  inProgress: InProgressProgress | null;
}

export interface GameProgressData {
  progress: GameProgress | null;
}

interface SongSnapshot {
  title: string;
  artist_name: string;
  cover_url: string | null;
}

interface GameCacheSnapshot {
  dayStatus: HomeDayStatusData | undefined;
  today: HomeTodayData | undefined;
  progress: GameProgressData | undefined;
}

type GameMutationEvent = "attemptSaved" | "gameCompleted";

type QueryDiagnosticRecord = {
  key: string;
  count: number;
  lastEvent: string;
  lastAt: number;
};

export interface ValidateGuessRequest {
  gameId: string;
  userId: string;
  attemptNumber: number;
  guessText: string;
  songId: string;
  guessArtistName?: string;
  guessAlbumTitle?: string;
  finalize?: boolean;
}

export interface ValidateGuessResponse {
  correct?: boolean;
  correctArtist?: boolean;
  correctAlbum?: boolean;
  totalPoints?: number;
  error?: string;
}

export interface SkipAttemptRequest {
  gameId: string;
  attemptNumber: number;
}

export interface SkipAttemptResponse {
  ok?: boolean;
  error?: string;
}

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

export interface RankingData {
  entries: Array<{
    user_id: string;
    total_points: number;
    streak: number;
    global_rank: number;
    aciertos: number;
    profiles: { display_name: string; avatar_url: string } | null;
  }>;
  currentUserId: string | null;
}

interface ProfileData {
  profile: {
    id: string;
    display_name: string;
    avatar_url: string;
    show_avatar_in_rankings: boolean;
    created_at: string;
    email: string;
    role: string | null;
  };
  stats: UserStats | null;
}

interface ProfileCoreData {
  profile: ProfileData["profile"];
  userId: string | null;
}

interface ProfileStatsData {
  stats: UserStats | null;
  userId: string | null;
}

export async function fetchProfileCoreData(): Promise<ProfileCoreData> {
  const res = await fetch("/api/profile/core");
  if (!res.ok) throw new Error("Failed to fetch profile core");
  return res.json();
}

export async function fetchProfileStatsData(): Promise<ProfileStatsData> {
  const res = await fetch("/api/profile/stats");
  if (!res.ok) throw new Error("Failed to fetch profile stats");
  return res.json();
}

export function useHomeData(
  userId: string | null,
  initialData?: HomeData
) {
  return useQuery({
    queryKey: queryKeys.home.all(userId),
    queryFn: async (): Promise<HomeData> => {
      const res = await fetch("/api/home", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch home data");
      return res.json();
    },
    initialData,
  });
}

export async function fetchHomePreviousDaysData(
  month: string
): Promise<HomePreviousDaysData> {
  const res = await fetch(
    `/api/home/previous-days?month=${encodeURIComponent(month)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("Failed to fetch previous days");
  return res.json();
}

export async function fetchGameById(gameId: string): Promise<GameWithSong | null> {
  const res = await fetch(`/api/game/${gameId}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error("Failed to fetch game");
  }
  return res.json();
}

export async function fetchGameProgressById(
  gameId: string
): Promise<GameProgressData> {
  const res = await fetch(`/api/game-progress/${gameId}`, { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 401 || res.status === 404) {
      return { progress: null };
    }
    throw new Error("Failed to fetch game progress");
  }
  return res.json();
}

export async function fetchHomeTodayData(): Promise<HomeTodayData> {
  const res = await fetch("/api/home/today", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch home today data");
  return res.json();
}

export function useHomeToday(
  userId: string | null,
  initialData?: HomeTodayData
) {
  return useQuery({
    queryKey: queryKeys.home.today(userId),
    queryFn: fetchHomeTodayData,
    initialData,
    staleTime: HOME_TODAY_STALE_MS,
    /** Al remontar la home (p. ej. desde ranking), alinear con servidor tras intentos en /play. */
    refetchOnMount: "always",
  });
}

export function useHomePreviousDays(
  month: string,
  userId: string | null,
  initialData?: HomePreviousDaysData
) {
  return useQuery({
    queryKey: queryKeys.home.previousDays(month, userId),
    queryFn: () => fetchHomePreviousDaysData(month),
    initialData,
    staleTime: HOME_PREVIOUS_DAYS_STALE_MS,
    gcTime: HOME_PREVIOUS_DAYS_GC_MS,
    refetchOnMount: "always",
  });
}

export function useHomeUserStats(
  userId: string | null,
  initialData?: HomeUserStatsData
) {
  return useQuery({
    queryKey: queryKeys.home.userStats(userId),
    queryFn: fetchHomeUserStatsData,
    initialData,
    enabled: userId != null,
    staleTime: HOME_TODAY_STALE_MS,
  });
}

export async function fetchHomeUserStatsData(): Promise<HomeUserStatsData> {
  const res = await fetch("/api/home/user-stats", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch home user stats");
  return res.json();
}

export function useHomeDayStatus(
  gameId: string,
  initialData?: HomeDayStatusData,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.home.dayStatus(gameId),
    queryFn: () => fetchHomeDayStatusById(gameId),
    initialData,
    enabled: (options?.enabled ?? true) && !!gameId,
    staleTime: HOME_DAY_STATUS_STALE_MS,
  });
}

export function useGameById(gameId: string, initialData?: GameWithSong | null) {
  return useQuery({
    queryKey: queryKeys.game.byId(gameId),
    queryFn: () => fetchGameById(gameId),
    initialData,
    enabled: !!gameId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useGameProgressById(
  gameId: string,
  options?: { enabled?: boolean; initialData?: GameProgressData }
) {
  return useQuery({
    queryKey: queryKeys.game.progress(gameId),
    queryFn: () => fetchGameProgressById(gameId),
    enabled: (options?.enabled ?? true) && !!gameId,
    initialData: options?.initialData,
    /** Siempre pedir datos al montar la partida: el GET incluye intentos y debe ganar a caché incompleta. */
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
}

export function prefetchGameById(queryClient: QueryClient, gameId: string) {
  if (!gameId) return Promise.resolve();
  return queryClient.prefetchQuery({
    queryKey: queryKeys.game.byId(gameId),
    queryFn: () => fetchGameById(gameId),
    staleTime: 5 * 60 * 1000,
  });
}

export function prefetchGameProgressById(
  queryClient: QueryClient,
  gameId: string
) {
  if (!gameId) return Promise.resolve();
  return queryClient.prefetchQuery({
    queryKey: queryKeys.game.progress(gameId),
    queryFn: () => fetchGameProgressById(gameId),
    /** Alineado con `useGameProgressById` — el GET debe poder sustituir seeds de la home. */
    staleTime: 0,
  });
}

export async function fetchHomeDayStatusById(
  gameId: string
): Promise<HomeDayStatusData> {
  const res = await fetch(`/api/home/day/${gameId}/status`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch day status");
  return res.json();
}

export function prefetchHomeDayStatusById(
  queryClient: QueryClient,
  gameId: string
) {
  if (!gameId) return Promise.resolve();
  return queryClient.prefetchQuery({
    queryKey: queryKeys.home.dayStatus(gameId),
    queryFn: () => fetchHomeDayStatusById(gameId),
    staleTime: HOME_DAY_STATUS_STALE_MS,
  });
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

    const status: HomeDayStatusData = {
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

function takeGameCacheSnapshot(
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

function restoreGameCacheSnapshot(
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

  await queryClient.refetchQueries({
    queryKey: queryKeys.game.progress(gameId),
  });
  await queryClient.refetchQueries({
    queryKey: queryKeys.home.dayStatus(gameId),
  });

  if (userId) {
    await queryClient.refetchQueries({
      queryKey: queryKeys.home.today(userId),
    });
  }

  const monthKey = getMonthKeyForGameFromCaches(queryClient, userId, gameId);
  if (userId && monthKey) {
    await queryClient.refetchQueries({
      queryKey: queryKeys.home.previousDays(monthKey, userId),
    });
  }

  patchHomePreviousDaysAllFromDayStatus(queryClient, userId, gameId);

  if (event === "gameCompleted") {
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

interface GameMutationBaseInput {
  userId: string | null;
  gameId: string;
  song: SongSnapshot;
  event: GameMutationEvent;
}

interface ValidateGuessMutationInput extends GameMutationBaseInput {
  request: ValidateGuessRequest;
  optimistic:
    | {
        type: "inProgress";
        inProgress: InProgressProgress;
      }
    | {
        type: "completion";
        won: boolean;
        score: number | null;
        completedProgress?: {
          gameDate?: string;
          guesses?: GameProgress["guesses"];
          correctAttempt?: number;
        };
      };
}

interface SkipAttemptMutationInput extends GameMutationBaseInput {
  request: SkipAttemptRequest;
  optimistic:
    | {
        type: "inProgress";
        inProgress: InProgressProgress;
      }
    | {
        type: "completion";
        won: boolean;
        score: number | null;
        completedProgress?: {
          gameDate?: string;
          guesses?: GameProgress["guesses"];
          correctAttempt?: number;
        };
      };
}

export function useValidateGuessMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    ValidateGuessResponse,
    Error,
    ValidateGuessMutationInput,
    GameCacheSnapshot
  >({
    mutationKey: ["game", "validate-guess"],
    meta: { skipGlobalErrorToast: true },
    mutationFn: async ({ request }) => {
      const res = await fetch("/api/validate-guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = (await res.json()) as ValidateGuessResponse;
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to validate guess"
        );
      }
      return data;
    },
    onMutate: async (variables) => {
      const { userId, gameId, optimistic, song } = variables;
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.home.dayStatus(gameId),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.game.progress(gameId),
        }),
        userId
          ? queryClient.cancelQueries({
              queryKey: queryKeys.home.today(userId),
            })
          : Promise.resolve(),
      ]);

      const snapshot = takeGameCacheSnapshot(queryClient, userId, gameId);
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
      return snapshot;
    },
    onError: (_error, variables, context) => {
      restoreGameCacheSnapshot(
        queryClient,
        variables.userId,
        variables.gameId,
        context
      );
    },
    onSettled: async (_data, _error, variables) => {
      await invalidateAfterGameEvent(queryClient, {
        userId: variables.userId,
        gameId: variables.gameId,
        event: variables.event,
      });
    },
  });
}

export function useSkipAttemptMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    SkipAttemptResponse,
    Error,
    SkipAttemptMutationInput,
    GameCacheSnapshot
  >({
    mutationKey: ["game", "skip-attempt"],
    meta: { skipGlobalErrorToast: true },
    mutationFn: async ({ request }) => {
      const res = await fetch("/api/skip-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = (await res.json()) as SkipAttemptResponse;
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to skip attempt"
        );
      }
      return data;
    },
    onMutate: async (variables) => {
      const { userId, gameId, optimistic, song } = variables;
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.home.dayStatus(gameId),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.game.progress(gameId),
        }),
        userId
          ? queryClient.cancelQueries({
              queryKey: queryKeys.home.today(userId),
            })
          : Promise.resolve(),
      ]);

      const snapshot = takeGameCacheSnapshot(queryClient, userId, gameId);
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
      return snapshot;
    },
    onError: (_error, variables, context) => {
      restoreGameCacheSnapshot(
        queryClient,
        variables.userId,
        variables.gameId,
        context
      );
    },
    onSettled: async (_data, _error, variables) => {
      await invalidateAfterGameEvent(queryClient, {
        userId: variables.userId,
        gameId: variables.gameId,
        event: variables.event,
      });
    },
  });
}

export interface UpdateProfileInput {
  username: string;
  avatar_url?: string;
  show_avatar_in_rankings?: boolean;
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["profile", "update"],
    meta: { skipGlobalErrorToast: true },
    mutationFn: async (input: UpdateProfileInput) => {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string" ? json.error : "Failed to update profile"
        );
      }
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
    },
  });
}

export interface SubmitFeedbackInput {
  type: "bug" | "error" | "suggestion";
  message: string;
  email?: string;
}

export function useSubmitFeedbackMutation() {
  return useMutation({
    mutationKey: ["feedback", "submit"],
    meta: { skipGlobalErrorToast: true },
    mutationFn: async (input: SubmitFeedbackInput) => {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(
          typeof json.error === "string" ? json.error : "Failed to submit feedback"
        );
      }
    },
  });
}

export interface ReportGameInput {
  gameId: string;
  songId: string;
  reason:
    | "bad_audio"
    | "wrong_video"
    | "intro_problem"
    | "explicit_content"
    | "other";
  description?: string;
}

export function useReportGameMutation() {
  return useMutation({
    mutationKey: ["game", "report"],
    meta: { skipGlobalErrorToast: true },
    mutationFn: async (input: ReportGameInput) => {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string" ? json.error : "Failed to save report"
        );
      }
      return json;
    },
  });
}

export function useLeaderboard(
  period: "weekly" | "monthly" | "global",
  initialByPeriod?: Partial<
    Record<"weekly" | "monthly" | "global", RankingData>
  >,
  legacyInitialData?: RankingData
) {
  const initialData =
    initialByPeriod?.[period] ??
    (period === "global" ? legacyInitialData : undefined);

  return useQuery({
    queryKey: queryKeys.ranking.period(period),
    queryFn: () => fetchLeaderboardPeriodData(period),
    initialData,
    staleTime: RANKING_STALE_MS,
  });
}

export async function fetchLeaderboardPeriodData(
  period: "weekly" | "monthly" | "global"
): Promise<RankingData> {
  const res = await fetch(`/api/ranking?period=${period}`);
  if (!res.ok) throw new Error("Failed to fetch leaderboard");
  return res.json();
}

export interface LeaderboardHistorySummary {
  period_start: string;
  period_end: string;
  winner_user_id: string | null;
  winner_points: number | null;
  winner_display_name: string | null;
  winner_avatar_url: string | null;
}

export interface LeaderboardHistoryDetailData extends RankingData {
  granularity: "weekly" | "monthly";
  anchor: string;
  periodStart: string;
  periodEnd: string;
}

export function useLeaderboardHistorySummaries(
  granularity: "weekly" | "monthly",
  initialByGranularity?: Partial<
    Record<"weekly" | "monthly", LeaderboardHistorySummary[]>
  >
) {
  return useQuery({
    queryKey: queryKeys.ranking.historySummaries(granularity),
    queryFn: async (): Promise<LeaderboardHistorySummary[]> => {
      const url =
        granularity === "monthly"
          ? "/api/ranking/history/summaries?granularity=monthly"
          : "/api/ranking/history/summaries?granularity=weekly&limit=12";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch history summaries");
      const json = (await res.json()) as { summaries: LeaderboardHistorySummary[] };
      return json.summaries ?? [];
    },
    initialData: initialByGranularity?.[granularity],
    staleTime: 60 * 60 * 1000,
  });
}

export function useLeaderboardHistoryDetail(
  granularity: "weekly" | "monthly",
  anchor: string,
  options?: { enabled?: boolean }
) {
  const enabled =
    (options?.enabled ?? true) &&
    !!anchor &&
    /^\d{4}-\d{2}-\d{2}$/.test(anchor);

  return useQuery({
    queryKey: queryKeys.ranking.historyDetail(granularity, anchor),
    queryFn: async (): Promise<LeaderboardHistoryDetailData> => {
      const res = await fetch(
        `/api/ranking/history/detail?granularity=${granularity}&anchor=${encodeURIComponent(anchor)}`
      );
      if (!res.ok) throw new Error("Failed to fetch history detail");
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
    enabled,
  });
}

export function useProfile(
  profileUserId: string | null,
  initialData?: ProfileData,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? true;
  const useInitial =
    !!initialData &&
    profileUserId != null &&
    initialData.profile.id === profileUserId;

  const initialCoreData: ProfileCoreData | undefined = useInitial
    ? { profile: initialData!.profile, userId: initialData!.profile.id }
    : undefined;
  const initialStatsData: ProfileStatsData | undefined = useInitial
    ? { stats: initialData!.stats, userId: initialData!.profile.id }
    : undefined;

  const [coreQuery, statsQuery] = useQueries({
    queries: [
      {
        queryKey: queryKeys.profile.section("core", profileUserId),
        queryFn: fetchProfileCoreData,
        initialData: initialCoreData,
        retry: 1,
        enabled,
        staleTime: PROFILE_STALE_MS,
      },
      {
        queryKey: queryKeys.profile.section("stats", profileUserId),
        queryFn: fetchProfileStatsData,
        initialData: initialStatsData,
        retry: 1,
        enabled,
        staleTime: PROFILE_STALE_MS,
      },
    ],
  });

  const data =
    coreQuery.data != null
      ? {
          profile: coreQuery.data.profile,
          stats: statsQuery.data?.stats ?? null,
        }
      : undefined;

  const isLoading =
    !coreQuery.data &&
    !coreQuery.isError &&
    (coreQuery.isPending || statsQuery.isPending);

  return {
    data,
    isLoading,
    isFetching: coreQuery.isFetching || statsQuery.isFetching,
    isError: coreQuery.isError || statsQuery.isError,
    coreError: coreQuery.isError,
    error: coreQuery.error ?? statsQuery.error,
    refetch: () =>
      Promise.all([coreQuery.refetch(), statsQuery.refetch()]).then(() => undefined),
  };
}

export interface EcosSong {
  id: string;
  title: string;
  artist_name: string;
  album_title?: string | null;
  cover_url: string | null;
  spotify_id: string | null;
}

export function useSearchSongs(query: string) {
  return useQuery({
    queryKey: queryKeys.search(query.trim()),
    queryFn: async (): Promise<EcosSong[]> => {
      const res = await fetch(
        `/api/search-songs?q=${encodeURIComponent(query.trim())}`
      );
      const json = (await res.json()) as { data: EcosSong[] };
      return json.data ?? [];
    },
    enabled: query.trim().length >= 2,
    staleTime: 60 * 1000,
  });
}
