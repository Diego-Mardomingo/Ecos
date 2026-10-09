"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  getEffectiveGameDate,
  getMadridDate,
  getTomorrowMadridDate,
} from "@/lib/date-utils";
import {
  isTerminalProgress,
  useGameProgressStore,
  type GameProgress,
} from "@/lib/store/gameProgressStore";
import {
  fetchHomeData,
  fetchHomeDayStatusById,
  homeHistoryFromHomeData,
  homeTodayFromHomeData,
  homeTodayQueryOptions,
  homeUserStatsFromHomeData,
  prefetchGameProgressById,
  primePlayQueriesFromHomeInitialData,
  queryKeys,
  useHomeHistory,
  useHomeToday,
  useHomeUserStats,
  type HomeData,
  type HomeDayStatusData,
  type HomePreviousDaysData,
  type HomeTodayData,
  type InProgressProgress,
  type TodaysCompletedResult,
} from "@/lib/hooks/queries";
import type { PreviousDayGame, GameWithSong } from "@/lib/queries/games";
import type { UserStats } from "@/lib/queries/users";
import { HomeSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/i18n/navigation";
import {
  applyDayStatusesToHistory,
  mergeHistoryBlock,
  mergeTodayData,
} from "@/components/home/homeHelpers";
import { HomeGuestCard, HomeProgress, type CompletedGame } from "@/components/home/HomeStats";
import { HomeArchive } from "@/components/home/HomeArchive";
import { HomeHeader } from "@/components/home/HomeHeader";
import { HomeTodayHero } from "@/components/home/HomeTodayHero";
import { HomeRecentDays } from "@/components/home/HomeRecentDays";
import { Countdown } from "@/components/home/HomeCountdown";
import { deriveHomeDayState, type DerivedHomeDayState } from "@/components/home/homeDayDerived";
import { attemptFromScore } from "@/lib/scoring";
import { useAuthStore } from "@/lib/store/authStore";
import {
  PLAY_SKELETON_VARIANT_KEY,
  type PlaySkeletonVariant,
} from "@/lib/navigation/playSkeletonStorage";
import { PLAY_NAVIGATION_START_EVENT } from "@/lib/navigation/playNavigationEvents";
import { PLAY_FROM_HOME_STORAGE_KEY } from "@/lib/navigation/useNavigateBackToHome";
import { consumeHomeSyncSignal } from "@/lib/consistencySync";
import { prefetchGameAudio, prefetchGameAudioWhenIdle } from "@/lib/audio/audioStore";

interface Props {
  initialData?: {
    todaysGame: GameWithSong | null;
    userStats: UserStats | null;
    userId: string | null;
    previousDays: PreviousDayGame[];
    inProgressByGameId?: Record<string, InProgressProgress>;
    todaysCompletedResult?: TodaysCompletedResult | null;
    rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
    rankingStats?: HomeData["rankingStats"];
    /** Ids que la home prefetchea, para sembrar su estado de progreso en caché. */
    prefetchGameIds?: string[];
  };
}

const EMPTY_DAYS: PreviousDayGame[] = [];
const EMPTY_IN_PROGRESS: Record<string, InProgressProgress> = {};

/** Cada cuánto se comprueba, con la home abierta, si ha cambiado el día de juego. */
const DAY_CHECK_INTERVAL_MS = 30 * 1000;
/** Si el servidor todavía no ha cambiado de día (reloj del cliente adelantado), se reintenta… */
const DAY_CHANGE_RETRY_MS = 60 * 1000;
/** …como mucho estas veces por día, para no insistir sin fin con un reloj muy desajustado. */
const DAY_CHANGE_MAX_ATTEMPTS = 5;

/** Fecha de juego a la que corresponden los datos de «hoy» que hay en caché. */
function cachedTodayDate(queryClient: QueryClient, userId: string | null): string | null {
  const state = queryClient.getQueryState<HomeTodayData>(queryKeys.home.today(userId));
  if (!state?.data) return null;
  return (
    state.data.todaysGame?.date ??
    (state.dataUpdatedAt ? getMadridDate(new Date(state.dataUpdatedAt)) : null)
  );
}

/**
 * Lleva a la caché lo que trae la página (RSC) o `/api/home`: «hoy» y el histórico, fusionados con
 * lo que ya hubiera (ver `mergeTodayData` y `mergeHistoryBlock`: lo terminado no vuelve atrás).
 *
 * Así cada visita a la home deja la caché al día sin pedir nada por API. Antes la caché ganaba al
 * RSC y, en cuanto pasaban 3 minutos, la home volvía a pedir hoy, el mes y, con él, todo el
 * histórico mes a mes. Si el payload no es del día de juego actual (una copia vieja del router),
 * no se adopta: marcaría como frescos datos de ayer, y del cambio de día ya se encarga
 * `syncGameDay`.
 */
function adoptHomePayload(queryClient: QueryClient, payload: HomeData, withUserStats: boolean) {
  if (payload.todaysGame && payload.todaysGame.date !== getEffectiveGameDate()) return;
  const userId = payload.userId ?? null;

  queryClient.setQueryData(queryKeys.home.today(userId), (prev: HomeTodayData | undefined) =>
    mergeTodayData(prev, homeTodayFromHomeData(payload))
  );

  // Lo que la partida haya dejado en el estado por día (si la home no estaba en caché cuando se
  // jugó, el histórico no se pudo parchear entonces).
  const statuses = userId
    ? queryClient
        .getQueriesData<HomeDayStatusData>({ queryKey: ["home", "day-status"] })
        .flatMap(([, status]) => (status ? [status] : []))
    : [];
  queryClient.setQueryData(
    queryKeys.home.previousDaysAll(userId),
    (prev: HomePreviousDaysData | undefined) => {
      const merged = mergeHistoryBlock(prev, homeHistoryFromHomeData(payload));
      return statuses.length ? applyDayStatusesToHistory(merged, statuses, false) : merged;
    }
  );

  if (withUserStats && userId) {
    queryClient.setQueryData(queryKeys.home.userStats(userId), homeUserStatsFromHomeData(payload));
  }
}

/**
 * Al volver de una partida (señal de `gameCacheSync`): lo justo para que la home refleje la
 * jugada aunque la sincronización en segundo plano no hubiera terminado.
 */
async function refreshAfterGameEvent(
  queryClient: QueryClient,
  userId: string,
  gameId: string,
  completed: boolean
) {
  const tasks: Array<Promise<unknown>> = [];
  const today = queryClient.getQueryData<HomeTodayData>(queryKeys.home.today(userId));
  if (today?.todaysGame?.id === gameId) {
    tasks.push(queryClient.fetchQuery({ ...homeTodayQueryOptions(userId), staleTime: 0 }));
  } else {
    tasks.push(
      queryClient
        .fetchQuery({
          queryKey: queryKeys.home.dayStatus(gameId),
          queryFn: () => fetchHomeDayStatusById(gameId),
          staleTime: 0,
        })
        .then((status) =>
          queryClient.setQueryData(
            queryKeys.home.previousDaysAll(userId),
            (prev: HomePreviousDaysData | undefined) =>
              prev ? applyDayStatusesToHistory(prev, [status], true) : prev
          )
        )
    );
  }
  if (completed) {
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.home.userStats(userId) }));
  }
  await Promise.allSettled(tasks);
}

export function HomeClient({ initialData }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  /**
   * Sesión efectiva. Mientras el cliente aún no sabe quién es, la del RSC; en cuanto lo sabe, solo
   * la suya. Antes se caía al id del RSC también después de cerrar sesión, y la caché persistida se
   * volvía a llenar con los datos del usuario anterior (PDATA-13).
   */
  const cacheUserId = authLoading ? (initialData?.userId ?? null) : (authUser?.id ?? null);
  const rsc =
    initialData != null && (initialData.userId ?? null) === cacheUserId ? initialData : undefined;

  const {
    data: todayData,
    isPending: isTodayPending,
  } = useHomeToday(cacheUserId, rsc ? homeTodayFromHomeData(rsc) : undefined);
  const {
    data: historyData,
    isPending: isHistoryPending,
  } = useHomeHistory(
    cacheUserId,
    rsc ? () => mergeHistoryBlock(undefined, homeHistoryFromHomeData(rsc)) : undefined
  );
  const { data: homeUserStatsData } = useHomeUserStats(
    cacheUserId,
    rsc ? homeUserStatsFromHomeData(rsc) : undefined
  );

  // El RSC de esta visita a la caché, antes de que los observadores se suscriban (efecto de
  // layout): así no piden nada por estar caducados.
  useLayoutEffect(() => {
    if (!rsc) return;
    adoptHomePayload(queryClient, rsc, false);
  }, [rsc, queryClient]);

  useLayoutEffect(() => {
    if (!rsc || !cacheUserId) return;
    primePlayQueriesFromHomeInitialData(queryClient, {
      userId: cacheUserId,
      prefetchGameIds: rsc.prefetchGameIds ?? [],
      inProgressByGameId: rsc.inProgressByGameId,
      todaysGame: rsc.todaysGame ?? null,
      todaysCompletedResult: rsc.todaysCompletedResult ?? null,
      previousDays: rsc.previousDays ?? [],
    });
  }, [rsc, cacheUserId, queryClient]);

  useEffect(() => {
    const signal = consumeHomeSyncSignal(cacheUserId);
    if (!signal || !cacheUserId) return;
    void refreshAfterGameEvent(
      queryClient,
      cacheUserId,
      signal.gameId,
      signal.event === "gameCompleted"
    );
  }, [cacheUserId, queryClient]);

  /* --- Cambio de día ------------------------------------------------------------------------ */

  /**
   * Antes el cambio de día solo se detectaba si la cuenta atrás veía pasar la medianoche con la
   * app delante. Con la PWA en segundo plano los temporizadores se congelan y la home seguía
   * enseñando el reto de ayer como «RETO DE HOY» (PDATA-08). Ahora se compara: la fecha de los
   * datos en caché contra el día de juego actual, al volver a primer plano, cada 30 s y al llegar
   * la cuenta atrás a cero.
   */
  const userIdRef = useRef(cacheUserId);
  useEffect(() => {
    userIdRef.current = cacheUserId;
  });
  const prefetchedNextRef = useRef<HomeData | null>(null);
  const dayChangeRef = useRef<{ date: string; at: number; count: number } | null>(null);

  const syncGameDay = useCallback(() => {
    const userId = userIdRef.current;
    const target = getEffectiveGameDate();
    const shown = cachedTodayDate(queryClient, userId);
    if (!shown || shown >= target) return;

    const now = Date.now();
    const last = dayChangeRef.current;
    if (
      last?.date === target &&
      (now - last.at < DAY_CHANGE_RETRY_MS || last.count >= DAY_CHANGE_MAX_ATTEMPTS)
    ) {
      return;
    }
    dayChangeRef.current = {
      date: target,
      at: now,
      count: last?.date === target ? last.count + 1 : 1,
    };

    const apply = (payload: HomeData) => {
      // Solo si es el día que toca y de esta sesión. Si el servidor aún no ha cambiado de día
      // (reloj del cliente adelantado), no se aplica: antes se escribía igualmente como el día
      // nuevo. Se reintenta en la siguiente comprobación.
      if (payload.todaysGame && payload.todaysGame.date !== target) return;
      if ((payload.userId ?? null) !== userIdRef.current) return;
      adoptHomePayload(queryClient, payload, true);
    };

    const prefetched = prefetchedNextRef.current;
    prefetchedNextRef.current = null;
    if (prefetched?.todaysGame?.date === target) {
      apply(prefetched);
      return;
    }
    void fetchHomeData().then(apply).catch(() => undefined);
  }, [queryClient]);

  /** A menos de 10 s de la medianoche: el día siguiente, para cambiar sin esperar a la red. */
  const prefetchNextDay = useCallback(() => {
    const requested = getTomorrowMadridDate();
    void fetchHomeData(requested)
      .then((payload) => {
        if (payload.todaysGame?.date === requested) prefetchedNextRef.current = payload;
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") syncGameDay();
    };
    document.addEventListener("visibilitychange", onVisible);
    // `resume`: la pestaña vuelve de estar congelada (Page Lifecycle), sin cambio de visibilidad.
    document.addEventListener("resume", syncGameDay);
    window.addEventListener("focus", syncGameDay);
    window.addEventListener("pageshow", syncGameDay);
    window.addEventListener("online", syncGameDay);
    const interval = window.setInterval(syncGameDay, DAY_CHECK_INTERVAL_MS);
    syncGameDay();
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("resume", syncGameDay);
      window.removeEventListener("focus", syncGameDay);
      window.removeEventListener("pageshow", syncGameDay);
      window.removeEventListener("online", syncGameDay);
      window.clearInterval(interval);
    };
  }, [syncGameDay]);

  /* --- Derivados ---------------------------------------------------------------------------- */

  const todaysGame = todayData?.todaysGame ?? null;
  const userId = cacheUserId;
  const previousDays = historyData?.previousDays ?? EMPTY_DAYS;
  const inProgressByGameId = historyData?.inProgressByGameId ?? EMPTY_IN_PROGRESS;
  const todaysCompletedResult = todayData?.todaysCompletedResult ?? null;
  const todaysServerInProgress = todaysCompletedResult ? null : (todayData?.todaysInProgress ?? null);
  const rankingStats = homeUserStatsData?.rankingStats;

  const t = useTranslations("home");
  const tMeta = useTranslations("meta");
  const locale = useLocale();
  const byGameId = useGameProgressStore((s) => s.byGameId);

  // Hoy: con sesión manda el progreso del servidor; sin ella, el guardado en este dispositivo.
  const todaysLocalOrServer = todaysGame
    ? (userId && todaysServerInProgress
        ? todaysServerInProgress
        : byGameId[todaysGame.id])
    : undefined;
  const todaysProgress = todaysLocalOrServer as GameProgress | undefined;
  const todaysCompleted = isTerminalProgress(todaysProgress) || !!todaysCompletedResult;
  const todaysDisplayCover = todaysCompleted
    ? (todaysCompletedResult?.cover_url ?? todaysProgress?.cover_url ?? todaysGame?.ecos_songs.cover_url ?? "")
    : "";
  /** Evita un frame sin imagen al completar: misma cadena de fallback que la carátula. */
  const heroBackdropUrl = todaysCompleted
    ? todaysDisplayCover || (todaysGame?.ecos_songs?.cover_url ?? "")
    : "";
  const todaysDisplayTitle = todaysCompleted
    ? (todaysCompletedResult?.title ?? todaysProgress?.title ?? todaysGame?.ecos_songs?.title ?? "")
    : "";
  const todaysDisplayArtist = todaysCompleted
    ? (todaysCompletedResult?.artist_name ?? todaysProgress?.artist_name ?? todaysGame?.ecos_songs?.artist_name ?? "")
    : "";
  const todaysDisplayScore = todaysCompleted
    ? (todaysCompletedResult?.score ?? todaysProgress?.score ?? null)
    : null;
  const todaysInProgress = todaysProgress?.phase === "playing" && (todaysProgress?.guesses?.length ?? 0) > 0;
  const todaysGuesses = todaysProgress?.guesses ?? [];
  const todaysWon = todaysCompletedResult?.won ?? todaysProgress?.phase === "won";

  // Solo el reto de hoy, y solo si a la caché le faltan sus intentos (partida terminada que el RSC
  // siembra como resumen). Antes se precargaban progreso y estado de cada día del mes en curso:
  // hasta 62 peticiones en cada carga de la home con sesión (PDATA-05).
  const todaysGameId = todaysGame?.id ?? null;
  useEffect(() => {
    if (!cacheUserId || !todaysGameId) return;
    void prefetchGameProgressById(queryClient, todaysGameId).catch(() => undefined);
  }, [cacheUserId, todaysGameId, queryClient]);

  useEffect(() => {
    router.prefetch("/play");
  }, [router]);

  // El MP3 de hoy, en reposo y solo si hay algo que jugar: con el reto sin audio o ya terminado no
  // se gasta red. Si se completa antes de que llegue el reposo, la limpieza lo cancela. El almacén
  // es idempotente y respeta el ahorro de datos.
  const todaysHasAudio = !!todaysGame?.ecos_songs.preview_url;
  useEffect(() => {
    if (!todaysGameId || !todaysHasAudio || todaysCompleted) return;
    return prefetchGameAudioWhenIdle(todaysGameId, "home (reposo)");
  }, [todaysGameId, todaysHasAudio, todaysCompleted]);

  /**
   * Partidas terminadas (fecha + intento del acierto) para la distribución de «Tu progreso».
   * Sin las queries de estado por día: los puntos del histórico bastan para saber el intento.
   */
  const completedGames: CompletedGame[] = [];
  for (const day of previousDays) {
    const d = deriveHomeDayState(day, userId, null, byGameId);
    if (d.completed) completedGames.push({ date: day.date, attempt: d.won ? attemptFromScore(d.displayScore) : null });
  }
  if (todaysGame && todaysCompleted) {
    completedGames.push({
      date: todaysGame.date,
      attempt: todaysWon ? attemptFromScore(todaysDisplayScore) : null,
    });
  }

  const markPlayNavigationStart = useCallback((variant: PlaySkeletonVariant) => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(PLAY_FROM_HOME_STORAGE_KEY, "1");
      sessionStorage.setItem(PLAY_SKELETON_VARIANT_KEY, variant);
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new CustomEvent(PLAY_NAVIGATION_START_EVENT));
    } catch {
      /* ignore */
    }
  }, []);

  const navigateToPlayToday = useCallback(() => {
    const variant: PlaySkeletonVariant = todaysCompleted ? "completed" : "in_progress";
    markPlayNavigationStart(variant);
    router.push("/play");
  }, [markPlayNavigationStart, router, todaysCompleted]);

  const prefetchTodayPlay = useCallback(() => {
    router.prefetch("/play");
    if (cacheUserId && todaysGameId) {
      void prefetchGameProgressById(queryClient, todaysGameId).catch(() => undefined);
    }
    // Intención de abrir el reto de hoy: si el reposo aún no ha llegado, el audio no espera.
    if (todaysGameId && todaysHasAudio && !todaysCompleted) {
      prefetchGameAudio(todaysGameId, "intención (hoy)");
    }
  }, [router, queryClient, cacheUserId, todaysGameId, todaysHasAudio, todaysCompleted]);

  const handleShareHome = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const url = locale === "en" ? `${base}/en` : `${base}/`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "ECOS",
          text: tMeta("ogDescription"),
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* ignore */
      }
    }
  };

  // isPending = aún no hay datos en caché (no confundir con refetch en background).
  // Con initialData del RSC o datos en QueryClient al volver atrás, no debe mostrarse skeleton.
  if ((isTodayPending || isHistoryPending) && !todayData && !historyData) {
    return <HomeSkeleton />;
  }

  const todayDate = todaysGame?.date ?? getEffectiveGameDate();
  const todayDerived: DerivedHomeDayState = {
    played: todaysCompleted,
    won: todaysWon === true,
    completed: todaysCompleted,
    inProgress: todaysInProgress,
    displayScore: todaysDisplayScore,
    displayTitle: todaysDisplayTitle,
    displayArtist: todaysDisplayArtist,
    displayCover: todaysDisplayCover,
    guesses: todaysGuesses,
    maxAttempts: 6,
  };

  return (
    <div className="flex min-h-full min-w-0 flex-col gap-[26px] px-4 pb-6">
      <div className="flex flex-col gap-3">
        <HomeHeader />

        <HomeTodayHero
          gameNumber={todaysGame?.game_number ?? null}
          gameDate={todaysGame?.date ?? null}
          completed={todaysCompleted}
          inProgress={todaysInProgress}
          won={todaysWon === true}
          guesses={todaysGuesses}
          cover={heroBackdropUrl}
          title={todaysDisplayTitle}
          artist={todaysDisplayArtist}
          score={todaysDisplayScore}
          onPlay={navigateToPlayToday}
          onPrefetch={prefetchTodayPlay}
          onShare={handleShareHome}
        />

        <div className="flex justify-center">
          <Countdown
            t={t}
            onCountdownUnder10s={prefetchNextDay}
            onCountdownZero={syncGameDay}
          />
        </div>
      </div>

      {/* Progreso por periodo, o el aviso para entrar si es invitado */}
      {userId && rankingStats ? (
        <HomeProgress rankingStats={rankingStats} completedGames={completedGames} todayDate={todayDate} />
      ) : userId ? (
        <Skeleton className="h-[290px] rounded-[22px]" />
      ) : (
        <HomeGuestCard />
      )}

      <HomeRecentDays
        previousDays={previousDays}
        todayDate={todayDate}
        userId={userId}
        inProgressByGameId={inProgressByGameId}
        onNavigateToGame={markPlayNavigationStart}
      />

      <HomeArchive
        previousDays={previousDays}
        userId={userId}
        inProgressByGameId={inProgressByGameId}
        onNavigateToGame={markPlayNavigationStart}
        today={
          todaysGame
            ? { date: todaysGame.date, gameNumber: todaysGame.game_number, derived: todayDerived }
            : null
        }
        onPlayToday={navigateToPlayToday}
      />
    </div>
  );
}
