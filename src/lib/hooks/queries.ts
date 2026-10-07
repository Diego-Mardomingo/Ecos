"use client";

import {
  queryOptions,
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
import { isTerminalProgress } from "@/lib/store/gameProgressStore";

import {
  HOME_HISTORY_GC_MS,
  HOME_USER_STATS_STALE_MS,
  PROFILE_STALE_MS,
  RANKING_STALE_MS,
  SEARCH_STALE_MS,
  homeSessionSegment,
  queryKeys,
  staleUntilMadridMidnight,
} from "./queryKeys";
import {
  fetchGameProgressById,
  fetchHomeDayStatusById,
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
  HomeData,
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
 * (`@/lib/hooks/queries`). Aquí viven los hooks y las opciones de cada query; las claves están en
 * `queryKeys.ts`, las formas de datos en `queryTypes.ts`, los fetchers en `queryFetchers.ts` y el
 * parcheado de caché en `gameCacheSync.ts`. Se re-exporta solo lo que se importa desde fuera.
 */
export {
  PROFILE_STALE_MS,
  RANKING_STALE_MS,
  homeSessionSegment,
  queryKeys,
};
export {
  fetchHomeDayStatusById,
  fetchHomeTodayData,
  fetchHomeUserStatsData,
  fetchLeaderboardPeriodData,
  fetchProfileCoreData,
  fetchProfileStatsData,
};
export { ApiError } from "./queryFetchers";
export {
  applyConfirmedProgressCaches,
  primePlayQueriesFromHomeInitialData,
} from "./gameCacheSync";
export type {
  GameOptimistic,
  GameProgressData,
  HomeData,
  HomeDayStatusData,
  HomePreviousDaysData,
  HomeTodayData,
  HomeUserStatsData,
  RankingData,
} from "./queryTypes";
export type { InProgressProgress, TodaysCompletedResult };

/* -------------------------------------------------------------------------------------------- */
/* Home                                                                                          */
/* -------------------------------------------------------------------------------------------- */

/**
 * Carga completa de la home (`/api/home`): hoy, histórico y estadísticas en una sola petición.
 * `effectiveDate` solo para la precarga del día siguiente en el último minuto antes de medianoche
 * (la ruta lo ignora fuera de esa ventana).
 */
export async function fetchHomeData(effectiveDate?: string): Promise<HomeData> {
  const url = effectiveDate
    ? `/api/home?effectiveDate=${encodeURIComponent(effectiveDate)}`
    : "/api/home";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch home data");
  return res.json();
}

export function homeTodayFromHomeData(data: HomeData): HomeTodayData {
  return {
    todaysGame: data.todaysGame,
    todaysCompletedResult: data.todaysCompletedResult ?? null,
    todaysInProgress: data.todaysGame
      ? (data.inProgressByGameId?.[data.todaysGame.id] ?? null)
      : null,
    userId: data.userId,
  };
}

export function homeHistoryFromHomeData(data: HomeData): HomePreviousDaysData {
  return {
    previousDays: data.previousDays,
    userId: data.userId,
    inProgressByGameId: data.inProgressByGameId ?? {},
  };
}

export function homeUserStatsFromHomeData(data: HomeData): HomeUserStatsData {
  return {
    userStats: data.userStats ?? null,
    rankingRanks: data.rankingRanks,
    rankingStats: data.rankingStats,
    userId: data.userId,
  };
}

/**
 * Opciones de cada query de la home: clave, fetcher y frescura juntos, para que el hook, los
 * `prefetchQuery` y los `fetchQuery` no los vuelvan a declarar cada uno a su manera (DUP-10).
 *
 * `today` e histórico solo cambian con el día de juego o por jugadas propias (que se parchean en
 * caché), así que son frescos hasta la medianoche de Madrid. Además, la home los vuelve a sembrar
 * con el RSC de cada visita (`HomeClient`), así que en la práctica no se piden por API.
 */
export function homeTodayQueryOptions(userId: string | null) {
  return queryOptions({
    queryKey: queryKeys.home.today(userId),
    queryFn: fetchHomeTodayData,
    staleTime: staleUntilMadridMidnight,
  });
}

/**
 * Histórico completo de la home. Normalmente lo trae el RSC; esta petición es el respaldo para
 * cuando la página no lo trae alineado con la sesión del cliente (un cambio de usuario en curso).
 * Antes se reconstruía pidiendo `/api/home/months` y un `previous-days` por mes, en cada vuelta a
 * la home: 13 peticiones que crecían una al mes (PDATA-05).
 */
export function homeHistoryQueryOptions(userId: string | null) {
  return queryOptions({
    queryKey: queryKeys.home.previousDaysAll(userId),
    queryFn: async () => homeHistoryFromHomeData(await fetchHomeData()),
    staleTime: staleUntilMadridMidnight,
    gcTime: HOME_HISTORY_GC_MS,
  });
}

export function homeUserStatsQueryOptions(userId: string | null) {
  return queryOptions({
    queryKey: queryKeys.home.userStats(userId),
    queryFn: fetchHomeUserStatsData,
    staleTime: HOME_USER_STATS_STALE_MS,
  });
}

export function useHomeToday(
  userId: string | null,
  initialData?: HomeTodayData
) {
  return useQuery({ ...homeTodayQueryOptions(userId), initialData });
}

/** `initialData` puede ser una función: el histórico solo se construye si la query aún no existe. */
export function useHomeHistory(
  userId: string | null,
  initialData?: HomePreviousDaysData | (() => HomePreviousDaysData)
) {
  return useQuery({ ...homeHistoryQueryOptions(userId), initialData });
}

export function useHomeUserStats(
  userId: string | null,
  initialData?: HomeUserStatsData
) {
  return useQuery({
    ...homeUserStatsQueryOptions(userId),
    initialData,
    enabled: userId != null,
  });
}

/** Partida terminada con su lista de intentos: ya no puede cambiar. */
function isSettledGameProgress(data: GameProgressData | undefined): boolean {
  const progress = data?.progress;
  return isTerminalProgress(progress) && (progress?.guesses?.length ?? 0) > 0;
}

/**
 * Frescura del progreso **al abrir la partida**. Por defecto se pide siempre al montar: el GET
 * trae los intentos y tiene que ganar a una caché incompleta (un resumen sin intentos, una partida
 * a medias que avanzó en otro dispositivo).
 *
 * La excepción es una partida terminada con sus intentos que ya ha pasado por la caché
 * (`dataUpdateCount > 0`: respuesta del servidor, jugada confirmada o caché persistida): no puede
 * cambiar, así que no se vuelve a pedir. Si solo es el `initialData` que pone `GameClient` desde el
 * progreso local, se pide igual: puede venir de una partida de invitado que el servidor no tiene,
 * y la reconciliación de `GameClient` necesita la respuesta.
 */
function openGameProgressStaleTime(query: {
  state: { data?: GameProgressData; dataUpdateCount: number };
}): number {
  return query.state.dataUpdateCount > 0 && isSettledGameProgress(query.state.data)
    ? Infinity
    : 0;
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
    staleTime: openGameProgressStaleTime,
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

/**
 * Frescura del progreso **para precargarlo**. Una partida terminada con su lista de intentos ya no
 * puede cambiar: no hace falta volver a pedirla. Lo demás se precarga como mucho cada 30 s, para
 * que pasar el dedo o el ratón varias veces por el mismo día no repita la petición (`/play` la
 * vuelve a pedir al montar de todas formas).
 */
function gameProgressStaleTime(query: { state: { data?: GameProgressData } }): number {
  return isSettledGameProgress(query.state.data) ? Infinity : 30 * 1000;
}

/**
 * Precarga el progreso de una partida antes de abrirla (intención del usuario en la home). Si la
 * caché ya tiene la partida terminada con sus intentos, no hace nada.
 */
export function prefetchGameProgressById(
  queryClient: QueryClient,
  gameId: string
) {
  if (!gameId) return Promise.resolve();
  return queryClient.prefetchQuery({
    queryKey: queryKeys.game.progress(gameId),
    queryFn: () => fetchGameProgressById(gameId),
    staleTime: gameProgressStaleTime,
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

export function profileCoreQueryOptions(userId: string | null) {
  return queryOptions({
    queryKey: queryKeys.profile.section("core", userId),
    queryFn: fetchProfileCoreData,
    staleTime: PROFILE_STALE_MS,
  });
}

export function profileStatsQueryOptions(userId: string | null) {
  return queryOptions({
    queryKey: queryKeys.profile.section("stats", userId),
    queryFn: fetchProfileStatsData,
    staleTime: PROFILE_STALE_MS,
  });
}

/**
 * Solo el núcleo del perfil (nombre, avatar). Para las barras de navegación, que antes usaban
 * `useProfile` y pedían también las estadísticas (dos RPC pesadas) solo para pintar el nombre
 * (PDATA-10).
 */
export function useProfileCore(userId: string | null) {
  return useQuery({
    ...profileCoreQueryOptions(userId),
    retry: 1,
    enabled: userId != null,
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
        ...profileCoreQueryOptions(profileUserId),
        initialData: initialCoreData,
        retry: 1,
        enabled,
      },
      {
        ...profileStatsQueryOptions(profileUserId),
        initialData: initialStatsData,
        retry: 1,
        enabled,
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
    staleTime: SEARCH_STALE_MS,
  });
}
