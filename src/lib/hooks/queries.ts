"use client";

import {
  useMutation,
  useQuery,
  useQueries,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  InProgressProgress,
  TodaysCompletedResult,
} from "@/lib/queries/games";
import type { GameProgress } from "@/lib/store/gameProgressStore";

import {
  HOME_DAY_STATUS_STALE_MS,
  HOME_PREVIOUS_DAYS_GC_MS,
  HOME_PREVIOUS_DAYS_STALE_MS,
  HOME_TODAY_STALE_MS,
  PROFILE_STALE_MS,
  RANKING_STALE_MS,
  homeSessionSegment,
  queryKeys,
} from "./queryKeys";
import {
  fetchGameProgressById,
  fetchHomeDayStatusById,
  fetchHomePreviousDaysData,
  fetchHomeTodayData,
  fetchHomeUserStatsData,
  fetchLeaderboardPeriodData,
  fetchProfileCoreData,
  fetchProfileStatsData,
} from "./queryFetchers";
import {
  applyOptimisticCompletionCaches,
  applyOptimisticInProgressCaches,
  invalidateAfterGameEvent,
  restoreGameCacheSnapshot,
  takeGameCacheSnapshot,
} from "./gameCacheSync";
import type {
  ProfileData,
  SkipAttemptRequest,
  SkipAttemptResponse,
  ValidateGuessRequest,
  ValidateGuessResponse,
  GameCacheSnapshot,
  GameMutationEvent,
  GameProgressData,
  HomeData,
  HomeDayStatusData,
  HomePreviousDaysData,
  HomeTodayData,
  HomeUserStatsData,
  ProfileCoreData,
  ProfileStatsData,
  RankingData,
  SongSnapshot,
} from "./queryTypes";

/**
 * Módulo central de datos en cliente. Sigue siendo el punto de importación de toda la app
 * (`@/lib/hooks/queries`), pero ahora solo contiene los hooks y los fetchers: las claves están en
 * `queryKeys.ts`, las formas de datos en `queryTypes.ts` y el parcheado de caché en
 * `gameCacheSync.ts`. Se re-exporta todo para no cambiar ningún sitio de uso.
 */
export {
  HOME_DAY_STATUS_STALE_MS,
  HOME_PREVIOUS_DAYS_GC_MS,
  HOME_PREVIOUS_DAYS_STALE_MS,
  HOME_TODAY_STALE_MS,
  PROFILE_STALE_MS,
  RANKING_STALE_MS,
  homeSessionSegment,
  queryKeys,
};
export {
  fetchGameProgressById,
  fetchHomeDayStatusById,
  fetchHomePreviousDaysData,
  fetchHomeTodayData,
  fetchHomeUserStatsData,
  fetchLeaderboardPeriodData,
  fetchProfileCoreData,
  fetchProfileStatsData,
};
export {
  applyOptimisticCompletionCaches,
  applyOptimisticInProgressCaches,
  completionToGameProgress,
  inProgressToGameProgress,
  invalidateAfterGameEvent,
  patchHomePreviousDaysAllFromDayStatus,
  primeHomeDayStatusCache,
  primePlayQueriesFromHomeInitialData,
  syncQueriesAfterGameEvent,
} from "./gameCacheSync";
export type {
  GameProgressData,
  HomeData,
  HomeDayStatusData,
  HomePreviousDaysData,
  HomeTodayData,
  HomeUserStatsData,
  RankingData,
  RankingStatsPeriod,
  SkipAttemptRequest,
  SkipAttemptResponse,
  ValidateGuessRequest,
  ValidateGuessResponse,
} from "./queryTypes";
export type { InProgressProgress, TodaysCompletedResult };



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





export function useHomeToday(
  userId: string | null,
  initialData?: HomeTodayData
) {
  return useQuery({
    queryKey: queryKeys.home.today(userId),
    queryFn: fetchHomeTodayData,
    initialData,
    staleTime: HOME_TODAY_STALE_MS,
    /**
     * Refetch en montaje solo cuando está stale.
     * Los casos críticos play->home se fuerzan con señal de sincronización dirigida.
     */
    refetchOnMount: true,
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
    /**
     * Refetch en montaje solo cuando está stale.
     * Los casos críticos play->home se fuerzan con señal de sincronización dirigida.
     */
    refetchOnMount: true,
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
    onSuccess: async (_data, variables) => {
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
    onSuccess: async (_data, variables) => {
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
