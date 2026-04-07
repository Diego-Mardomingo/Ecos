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
    queryFn: async (): Promise<HomeDayStatusData> => {
      const res = await fetch(`/api/home/day/${gameId}/status`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch day status");
      return res.json();
    },
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
    staleTime: 60 * 1000,
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
    staleTime: 60 * 1000,
  });
}

function normalizeCoverUrl(coverUrl: string | null | undefined): string {
  return coverUrl ?? "";
}

export function primeHomeDayStatusCache(
  queryClient: QueryClient,
  previousDays: PreviousDayGame[],
  inProgressByGameId?: Record<string, InProgressProgress>
) {
  for (const day of previousDays) {
    const inProgress = inProgressByGameId?.[day.id] ?? null;
    const status: HomeDayStatusData = {
      gameId: day.id,
      played: day.played,
      won: day.won,
      score: day.score,
      title: day.title,
      artist_name: day.artist_name,
      cover_url: day.cover_url,
      inProgress,
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
}

export function applyOptimisticCompletionCaches(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    gameId: string;
    won: boolean;
    score: number | null;
    song: SongSnapshot;
  }
) {
  const { userId, gameId, won, score, song } = input;
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
}

export async function invalidateAfterGameMutation(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    gameId: string;
    includeHome?: boolean;
  }
) {
  const { userId, gameId, includeHome = true } = input;
  trackQueryDiagnostic(queryKeys.ranking.all, "invalidateAfterGameMutation");
  trackQueryDiagnostic(queryKeys.profile.all, "invalidateAfterGameMutation");
  const tasks: Array<Promise<unknown>> = [
    queryClient.invalidateQueries({ queryKey: queryKeys.ranking.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.profile.all }),
  ];

  if (userId) {
    trackQueryDiagnostic(
      queryKeys.home.userStats(userId),
      "invalidateAfterGameMutation"
    );
    tasks.push(
      queryClient.invalidateQueries({
        queryKey: queryKeys.home.userStats(userId),
      })
    );
  }

  if (includeHome) {
    trackQueryDiagnostic(
      queryKeys.home.dayStatus(gameId),
      "invalidateAfterGameMutation"
    );
    trackQueryDiagnostic(
      queryKeys.home.previousDaysAll(userId),
      "invalidateAfterGameMutation"
    );
    trackQueryDiagnostic(["home", "previous-days"], "invalidateAfterGameMutation");
    tasks.push(
      queryClient.invalidateQueries({ queryKey: queryKeys.home.dayStatus(gameId) }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.home.previousDaysAll(userId),
      }),
      queryClient.invalidateQueries({
        queryKey: ["home", "previous-days"],
      })
    );
    if (userId) {
      trackQueryDiagnostic(queryKeys.home.today(userId), "invalidateAfterGameMutation");
      tasks.push(
        queryClient.invalidateQueries({ queryKey: queryKeys.home.today(userId) })
      );
    }
  }

  await Promise.all(tasks);
}

export async function invalidateAfterGameEvent(
  queryClient: QueryClient,
  input: {
    userId: string | null;
    gameId: string;
    event: GameMutationEvent;
  }
) {
  const { userId, gameId, event } = input;

  if (event === "attemptSaved") {
    trackQueryDiagnostic(queryKeys.home.dayStatus(gameId), "attemptSaved");
    const tasks: Array<Promise<unknown>> = [
      queryClient.invalidateQueries({
        queryKey: queryKeys.home.dayStatus(gameId),
      }),
    ];
    if (userId) {
      trackQueryDiagnostic(queryKeys.home.today(userId), "attemptSaved");
      tasks.push(
        queryClient.invalidateQueries({
          queryKey: queryKeys.home.today(userId),
        })
      );
    }
    await Promise.all(tasks);
    return;
  }

  await invalidateAfterGameMutation(queryClient, {
    userId,
    gameId,
    includeHome: true,
  });
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
