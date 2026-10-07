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
  postJson,
} from "./queryFetchers";
import {
  applyGameOptimisticCaches,
  restoreGameCacheSnapshot,
  syncQueriesAfterGameEvent,
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
  GameOptimistic,
  GameProgressData,
  HomePreviousDaysData,
  HomeTodayData,
  HomeUserStatsData,
  ProfileCoreData,
  ProfileStatsData,
  RankingData,
  SongSnapshot,
} from "./queryTypes";

/**
 * Módulo central de datos en cliente y punto de importación de toda la app
 * (`@/lib/hooks/queries`). Aquí viven los hooks; las claves están en `queryKeys.ts`, las formas
 * de datos en `queryTypes.ts`, los fetchers en `queryFetchers.ts` y el parcheado de caché en
 * `gameCacheSync.ts`. Se re-exporta solo lo que se importa desde fuera.
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
  fetchHomeDayStatusById,
  fetchHomePreviousDaysData,
  fetchHomeTodayData,
  fetchHomeUserStatsData,
  fetchLeaderboardPeriodData,
  fetchProfileCoreData,
  fetchProfileStatsData,
};
export { ApiError } from "./queryFetchers";
export {
  applyConfirmedProgressCaches,
  primeHomeDayStatusCache,
  primePlayQueriesFromHomeInitialData,
} from "./gameCacheSync";
export type {
  GameOptimistic,
  GameProgressData,
  HomeData,
  HomeDayStatusData,
  HomePreviousDaysData,
  HomeTodayData,
  RankingData,
} from "./queryTypes";
export type { InProgressProgress, TodaysCompletedResult };

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

/**
 * Progreso de la partida recién pedido al servidor, sin pasar por caché. Para cuando el cliente
 * sabe que su copia ya no vale (el servidor ha dicho que la partida estaba cerrada, o ha
 * registrado la jugada en otro intento).
 */
export function fetchFreshGameProgress(
  queryClient: QueryClient,
  gameId: string
): Promise<GameProgressData> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.game.progress(gameId),
    queryFn: () => fetchGameProgressById(gameId),
    staleTime: 0,
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

interface GameMutationInput<TRequest> {
  userId: string | null;
  gameId: string;
  song: SongSnapshot;
  event: GameMutationEvent;
  request: TRequest;
  optimistic: GameOptimistic;
}

/**
 * Ciclo de vida común a las dos mutaciones de partida (intento y salto), que antes estaba
 * copiado entero en cada una.
 *
 * - `onMutate`: cancela los refetch en vuelo de esta partida (no pueden pisar lo optimista),
 *   guarda una foto de la caché y aplica el cambio optimista.
 * - `onError`: vuelve a la foto. Solo se llega aquí si el servidor **no** ha aceptado la jugada.
 * - `onSuccess`: lanza la sincronización en segundo plano y **no la espera**. Antes la esperaba:
 *   la mutación tardaba varios segundos en resolverse (cuatro refetch en serie), la partida
 *   descartaba en silencio cualquier jugada hecha mientras tanto, y si fallaba un refetch se
 *   revertía en pantalla una jugada que el servidor ya había guardado (PDATA-01).
 */
function gameMutationCallbacks<TRequest>(queryClient: QueryClient) {
  return {
    onMutate: async (variables: GameMutationInput<TRequest>) => {
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
      applyGameOptimisticCaches(queryClient, { userId, gameId, song, optimistic });
      return snapshot;
    },
    onError: (
      _error: Error,
      variables: GameMutationInput<TRequest>,
      context: GameCacheSnapshot | undefined
    ) => {
      restoreGameCacheSnapshot(
        queryClient,
        variables.userId,
        variables.gameId,
        context
      );
    },
    onSuccess: (_data: unknown, variables: GameMutationInput<TRequest>) => {
      void syncQueriesAfterGameEvent(queryClient, {
        userId: variables.userId,
        gameId: variables.gameId,
        event: variables.event,
      });
    },
  };
}

export function useValidateGuessMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    ValidateGuessResponse,
    Error,
    GameMutationInput<ValidateGuessRequest>,
    GameCacheSnapshot
  >({
    mutationKey: ["game", "validate-guess"],
    meta: { skipGlobalErrorToast: true },
    mutationFn: ({ request }) =>
      postJson<ValidateGuessResponse>(
        "/api/validate-guess",
        request,
        "Failed to validate guess"
      ),
    ...gameMutationCallbacks<ValidateGuessRequest>(queryClient),
  });
}

export function useSkipAttemptMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    SkipAttemptResponse,
    Error,
    GameMutationInput<SkipAttemptRequest>,
    GameCacheSnapshot
  >({
    mutationKey: ["game", "skip-attempt"],
    meta: { skipGlobalErrorToast: true },
    mutationFn: ({ request }) =>
      postJson<SkipAttemptResponse>(
        "/api/skip-attempt",
        request,
        "Failed to skip attempt"
      ),
    ...gameMutationCallbacks<SkipAttemptRequest>(queryClient),
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
    mutationFn: (input: UpdateProfileInput) =>
      postJson<{ error?: string }>(
        "/api/profile",
        input,
        "Failed to update profile",
        "PATCH"
      ),
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
      await postJson("/api/feedback", input, "Failed to submit feedback");
    },
  });
}

export interface ReportGameInput {
  gameId: string;
  songId: string;
  reason: "bad_audio" | "intro_problem" | "explicit_content" | "other";
  description?: string;
}

export function useReportGameMutation() {
  return useMutation({
    mutationKey: ["game", "report"],
    meta: { skipGlobalErrorToast: true },
    mutationFn: (input: ReportGameInput) =>
      postJson<{ error?: string }>("/api/report", input, "Failed to save report"),
  });
}

export function useLeaderboard(
  period: "weekly" | "monthly" | "global",
  initialByPeriod?: Partial<
    Record<"weekly" | "monthly" | "global", RankingData>
  >
) {
  return useQuery({
    queryKey: queryKeys.ranking.period(period),
    queryFn: () => fetchLeaderboardPeriodData(period),
    initialData: initialByPeriod?.[period],
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
      // Un fallo de la API no es «sin resultados»: se lanza para que el buscador pueda decirlo
      // (UX-04). Antes un 401 o un 500 se convertía en una lista vacía.
      if (!res.ok) throw new Error(`Failed to search songs (${res.status})`);
      const json = (await res.json()) as { data?: EcosSong[] };
      return json.data ?? [];
    },
    enabled: query.trim().length >= 2,
    staleTime: 60 * 1000,
  });
}
