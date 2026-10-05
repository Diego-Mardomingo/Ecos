"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  getEffectiveGameDate,
  getMadridDate,
  getTomorrowMadridDate,
} from "@/lib/date-utils";
import { useGameProgressStore, type GameProgress } from "@/lib/store/gameProgressStore";
import { useQueryClient } from "@tanstack/react-query";
import {
  useHomeToday,
  useHomePreviousDays,
  useHomeUserStats,
  fetchHomeDayStatusById,
  fetchHomeUserStatsData,
  prefetchGameProgressById,
  prefetchHomeDayStatusById,
  primeHomeDayStatusCache,
  primePlayQueriesFromHomeInitialData,
  homeSessionSegment,
  queryKeys,
  fetchHomePreviousDaysData,
  HOME_PREVIOUS_DAYS_GC_MS,
  HOME_PREVIOUS_DAYS_STALE_MS,
  type HomeData,
  type HomeTodayData,
  type InProgressProgress,
  type HomePreviousDaysData,
} from "@/lib/hooks/queries";
import type { PreviousDayGame, GameWithSong } from "@/lib/queries/games";
import { HomeSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/i18n/navigation";
import {
  HOME_EAGER_PREFETCH_MAX,
  HOME_PREFETCH_STRATEGY,
  MAX_PREFETCH_HISTORY_MONTHS_SAFETY,
  mergeInProgressByGameId,
  mergeInProgressPreferringMoreGuesses,
  mergePreviousDays,
  runBatched,
} from "@/components/home/homeHelpers";
import { HomeGuestCard, HomeProgress, type CompletedGame } from "@/components/home/HomeStats";
import { HomeArchive } from "@/components/home/HomeArchive";
import { HomeHeader } from "@/components/home/HomeHeader";
import { HomeTodayHero } from "@/components/home/HomeTodayHero";
import { HomeRecentDays } from "@/components/home/HomeRecentDays";
import { Countdown } from "@/components/home/HomeCountdown";
import { deriveHomeDayState } from "@/components/home/homeDayDerived";
import { attemptFromScore } from "@/lib/scoring";
import { useAuthStore } from "@/lib/store/authStore";
import {
  PLAY_SKELETON_VARIANT_KEY,
  type PlaySkeletonVariant,
} from "@/lib/navigation/playSkeletonStorage";
import { PLAY_NAVIGATION_START_EVENT } from "@/lib/navigation/playNavigationEvents";
import { consumeHomeSyncSignal } from "@/lib/consistencySync";

interface Props {
  initialData?: {
    todaysGame: GameWithSong | null;
    userStats: import("@/lib/queries/users").UserStats | null;
    userId: string | null;
    previousDays: PreviousDayGame[];
    inProgressByGameId?: Record<string, import("@/lib/hooks/queries").InProgressProgress>;
    todaysCompletedResult?: import("@/lib/hooks/queries").TodaysCompletedResult | null;
    rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
    rankingStats?: HomeData["rankingStats"];
    /** Ids que la home prefetchea, para sembrar su estado de progreso en caché. */
    prefetchGameIds?: string[];
  };
}

export function HomeClient({ initialData }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const authUser = useAuthStore((s) => s.user);
  const currentMonthKey = getMadridDate().slice(0, 7);
  /** Sesión efectiva: store primero; si aún no hidrata, coincide con el RSC. */
  const cacheUserId = authUser?.id ?? initialData?.userId ?? null;
  const initialDataAligned =
    initialData != null &&
    (initialData.userId ?? null) === (cacheUserId ?? null);

  const initialTodayData =
    initialDataAligned && initialData
      ? {
          todaysGame: initialData.todaysGame,
          todaysCompletedResult: initialData.todaysCompletedResult ?? null,
          todaysInProgress: initialData.todaysGame
            ? (initialData.inProgressByGameId?.[initialData.todaysGame.id] ?? null)
            : null,
          userId: initialData.userId,
        }
      : undefined;
  const initialPreviousDaysData =
    initialDataAligned && initialData
      ? {
          previousDays: initialData.previousDays,
          userId: initialData.userId,
          month: currentMonthKey,
          nextMonth: null,
          hasMoreOlder: false,
          inProgressByGameId: initialData.inProgressByGameId,
        }
      : undefined;
  const initialUserStatsData =
    initialDataAligned && initialData
      ? {
          userStats: initialData.userStats ?? null,
          rankingRanks: initialData.rankingRanks,
          rankingStats: initialData.rankingStats,
          userId: initialData.userId,
        }
      : undefined;

  const {
    data: todayData,
    isPending: isTodayPending,
    refetch: refetchToday,
  } = useHomeToday(cacheUserId, initialTodayData);
  const {
    data: previousDaysData,
    isPending: isPreviousDaysPending,
    refetch: refetchPreviousDays,
  } = useHomePreviousDays(currentMonthKey, cacheUserId, initialPreviousDaysData);

  useEffect(() => {
    const signal = consumeHomeSyncSignal(cacheUserId);
    if (!signal) return;

    const tasks: Array<Promise<unknown>> = [
      refetchToday(),
      queryClient.fetchQuery({
        queryKey: queryKeys.home.dayStatus(signal.gameId),
        queryFn: () => fetchHomeDayStatusById(signal.gameId),
        staleTime: 0,
      }),
    ];

    if (signal.event === "gameCompleted") {
      tasks.push(refetchPreviousDays());
      if (cacheUserId) {
        tasks.push(
          queryClient.fetchQuery({
            queryKey: queryKeys.home.userStats(cacheUserId),
            queryFn: fetchHomeUserStatsData,
            staleTime: 0,
          })
        );
      }
    }

    void Promise.allSettled(tasks);
  }, [cacheUserId, queryClient, refetchPreviousDays, refetchToday]);

  const resolvedUserId =
    todayData?.userId ??
    previousDaysData?.userId ??
    initialData?.userId ??
    null;

  const { data: homeUserStatsData } = useHomeUserStats(
    resolvedUserId,
    initialUserStatsData
  );
  const [previousDaysMerged, setPreviousDaysMerged] = useState<PreviousDayGame[]>(
    () => (initialDataAligned ? initialData?.previousDays ?? [] : [])
  );
  const [inProgressByGameId, setInProgressByGameId] = useState<
    Record<string, InProgressProgress>
  >(() => {
    if (!initialDataAligned || !initialData) return {};
    const uid = initialData.userId ?? null;
    if (!uid) return initialData.inProgressByGameId ?? {};
    const rsc = initialData.inProgressByGameId ?? {};
    const fromAll =
      queryClient.getQueryData<HomePreviousDaysData>(
        queryKeys.home.previousDaysAll(uid)
      )?.inProgressByGameId ?? {};
    const fromMonth =
      queryClient.getQueryData<HomePreviousDaysData>(
        queryKeys.home.previousDays(currentMonthKey, uid)
      )?.inProgressByGameId ?? {};
    return mergeInProgressPreferringMoreGuesses(
      mergeInProgressPreferringMoreGuesses(rsc, fromAll),
      fromMonth
    );
  });
  const prefetchStartedRef = useRef(false);
  const prefetchedProgressIdsRef = useRef<Set<string>>(new Set());

  const todaysCompletedResultEffective = useMemo(() => {
    if (!initialDataAligned) return todayData?.todaysCompletedResult ?? null;
    // Con datos de React Query, null es válido (no completado); no usar ?? hacia RSC.
    if (todayData !== undefined) {
      return todayData.todaysCompletedResult ?? null;
    }
    return initialData?.todaysCompletedResult ?? null;
  }, [initialDataAligned, todayData, initialData?.todaysCompletedResult]);

  const todaysServerInProgressEffective = useMemo(() => {
    if (todaysCompletedResultEffective) return null;
    const fromRsc =
      initialDataAligned && initialData?.todaysGame
        ? initialData.inProgressByGameId?.[initialData.todaysGame.id] ?? null
        : null;
    // todaysInProgress === null del API no debe sustituirse por inProgress obsoleto del RSC.
    if (todayData !== undefined) {
      return todayData.todaysInProgress ?? null;
    }
    return fromRsc;
    // `initialData` entero: el compilador infiere esa dependencia, y desglosarla en
    // propiedades sueltas le impide preservar la memoización del componente.
  }, [
    todayData,
    initialDataAligned,
    initialData,
    todaysCompletedResultEffective,
  ]);

  useLayoutEffect(() => {
    if (!initialDataAligned || !cacheUserId || !initialData?.todaysCompletedResult) return;
    const cached = queryClient.getQueryData<HomeTodayData>(
      queryKeys.home.today(cacheUserId)
    );
    if (cached?.todaysCompletedResult) return;
    queryClient.setQueryData(queryKeys.home.today(cacheUserId), (prev) => {
      const base = (prev ?? {}) as Partial<HomeTodayData>;
      return {
        ...base,
        todaysGame: base.todaysGame ?? initialData.todaysGame ?? null,
        userId: cacheUserId,
        todaysCompletedResult: initialData.todaysCompletedResult ?? null,
        todaysInProgress: null,
      } as HomeTodayData;
    });
  }, [
    initialDataAligned,
    cacheUserId,
    initialData?.todaysCompletedResult,
    initialData?.todaysGame,
    queryClient,
  ]);

  useLayoutEffect(() => {
    if (!initialDataAligned || !cacheUserId || !initialData) return;
    primePlayQueriesFromHomeInitialData(queryClient, {
      userId: cacheUserId,
      prefetchGameIds: initialData.prefetchGameIds ?? [],
      inProgressByGameId: initialData.inProgressByGameId,
      todaysGame: initialData.todaysGame ?? null,
      todaysCompletedResult: initialData.todaysCompletedResult ?? null,
      previousDays: initialData.previousDays ?? [],
    });
  }, [
    initialDataAligned,
    cacheUserId,
    queryClient,
    initialData,
  ]);

  /**
   * Partidas que se prefetchean al cargar: el reto de hoy y los días del mes en curso.
   *
   * Antes eran **todas** las del histórico. Como el bucle hace hasta cuatro peticiones por día
   * (ruta, juego, progreso y estado) y el progreso va con `staleTime: 0`, con un año de juego eso
   * son ~1.500 peticiones en cada carga de la home, creciendo cada día que pasa.
   *
   * El resto de días ya los cubre `PrefetchPlayOnVisible` cuando la tarjeta entra en el viewport,
   * más su `onMouseEnter`/`onFocus`: el mismo trabajo, pero solo para los días que el usuario
   * llega a ver. Hacerlo también aquí era duplicarlo por adelantado.
   */
  const eagerPrefetchGameIds = useMemo(() => {
    const ids: string[] = [];
    const tg = todayData?.todaysGame ?? initialData?.todaysGame;
    if (tg?.id) ids.push(tg.id);
    for (const d of previousDaysMerged) {
      if (d.id === tg?.id) continue;
      if (!d.date.startsWith(currentMonthKey)) continue;
      if (ids.length >= HOME_EAGER_PREFETCH_MAX) break;
      ids.push(d.id);
    }
    return ids;
  }, [
    todayData?.todaysGame,
    initialData?.todaysGame,
    previousDaysMerged,
    currentMonthKey,
  ]);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    return cache.subscribe((event) => {
      if (event.type !== "updated" || !event.query) return;
      const key = event.query.queryKey;
      if (
        key[0] !== "home" ||
        key[1] !== "previous-days" ||
        key[2] !== "all" ||
        key[3] !== homeSessionSegment(cacheUserId)
      ) {
        return;
      }
      const block = queryClient.getQueryData<HomePreviousDaysData>(
        queryKeys.home.previousDaysAll(cacheUserId)
      );
      if (!block?.previousDays?.length) return;
      setPreviousDaysMerged((prev) => mergePreviousDays(prev, block.previousDays));
      if (block.inProgressByGameId) {
        setInProgressByGameId((p) =>
          mergeInProgressByGameId(p, block.inProgressByGameId)
        );
      }
    });
  }, [queryClient, cacheUserId]);

  // Acumulación de los meses que van llegando. Se hace ajustando el estado durante
  // el render en lugar de en un efecto: así los updaters quedan puros. Antes las
  // escrituras en la caché de queries vivían dentro del updater, que React puede
  // ejecutar más de una vez.
  const [lastMergedSource, setLastMergedSource] = useState<
    HomePreviousDaysData | undefined
  >(undefined);
  if (previousDaysData?.previousDays && previousDaysData !== lastMergedSource) {
    setLastMergedSource(previousDaysData);
    setInProgressByGameId((prev) =>
      mergeInProgressByGameId(prev, previousDaysData.inProgressByGameId)
    );
    setPreviousDaysMerged((prev) =>
      mergePreviousDays(prev, previousDaysData.previousDays)
    );
  }

  // Reflejar el resultado ya acumulado en la caché de queries (sistema externo).
  useEffect(() => {
    if (!previousDaysData?.previousDays) return;
    primeHomeDayStatusCache(
      queryClient,
      previousDaysData.previousDays,
      inProgressByGameId
    );
    queryClient.setQueryData(queryKeys.home.previousDaysAll(cacheUserId), {
      previousDays: previousDaysMerged,
      userId: previousDaysData.userId ?? resolvedUserId ?? null,
      month: previousDaysData.month,
      nextMonth: previousDaysData.nextMonth ?? null,
      hasMoreOlder: previousDaysData.hasMoreOlder,
      inProgressByGameId,
    } satisfies HomePreviousDaysData);
  }, [
    previousDaysData,
    previousDaysMerged,
    inProgressByGameId,
    queryClient,
    resolvedUserId,
    cacheUserId,
  ]);

  useEffect(() => {
    if (previousDaysData?.hasMoreOlder === false) return;
    if (prefetchStartedRef.current) return;
    const startMonth = previousDaysData?.nextMonth ?? null;
    if (HOME_PREFETCH_STRATEGY === "sequential" && !startMonth) return;
    prefetchStartedRef.current = true;

    let cancelled = false;

    /**
     * Recorre el histórico mes a mes siguiendo `nextMonth`. Lo usan tanto la estrategia
     * secuencial como el fallback de `full-parallel` cuando `/api/home/months` no responde.
     */
    const walkMonthsSequentially = async (from: string | null) => {
      let monthCursor: string | null = from;
      let count = 0;
      while (
        !cancelled &&
        monthCursor &&
        count < MAX_PREFETCH_HISTORY_MONTHS_SAFETY
      ) {
        // Fijar el cursor de esta iteración: monthCursor se reasigna al final del
        // bucle, y capturarlo directamente en el closure de queryFn confunde al
        // análisis del compilador (además de ser frágil).
        const month: string = monthCursor;
        try {
          const payload: HomePreviousDaysData = await queryClient.fetchQuery({
            queryKey: queryKeys.home.previousDays(month, cacheUserId),
            queryFn: () => fetchHomePreviousDaysData(month),
            staleTime: HOME_PREVIOUS_DAYS_STALE_MS,
            gcTime: HOME_PREVIOUS_DAYS_GC_MS,
          });
          setInProgressByGameId((prevInProgress) => {
            const mergedInProgress = mergeInProgressByGameId(
              prevInProgress,
              payload.inProgressByGameId
            );
            primeHomeDayStatusCache(
              queryClient,
              payload.previousDays ?? [],
              mergedInProgress
            );
            return mergedInProgress;
          });
          setPreviousDaysMerged((prev) => {
            const merged = mergePreviousDays(prev, payload.previousDays ?? []);
            const previousAll =
              queryClient.getQueryData<HomePreviousDaysData>(
                queryKeys.home.previousDaysAll(cacheUserId)
              );
            queryClient.setQueryData(queryKeys.home.previousDaysAll(cacheUserId), {
              previousDays: merged,
              userId: previousAll?.userId ?? resolvedUserId ?? null,
              nextMonth: payload.nextMonth ?? null,
              hasMoreOlder: payload.hasMoreOlder ?? previousAll?.hasMoreOlder,
              month: previousAll?.month,
              inProgressByGameId: mergeInProgressByGameId(
                previousAll?.inProgressByGameId ?? {},
                payload.inProgressByGameId
              ),
            } satisfies HomePreviousDaysData);
            return merged;
          });
          monthCursor = payload.nextMonth ?? null;
        } catch (error) {
          // Cortar aqui deja el historico incompleto sin que se note en la UI: el usuario ve
          // menos meses de los que hay y no hay nada que lo delate. Por eso se loguea, al
          // contrario que los catch de sessionStorage/clipboard, donde el fallo es inocuo.
          console.error("[home] prefetch del historico interrumpido en", month, error);
          break;
        }
        count += 1;
      }
    };

    const run = async () => {
      if (HOME_PREFETCH_STRATEGY === "sequential") {
        await walkMonthsSequentially(startMonth);
        return;
      }

      const monthsRes = await fetch("/api/home/months", { cache: "no-store" }).catch(
        () => null
      );
      if (!monthsRes?.ok || cancelled) {
        await walkMonthsSequentially(startMonth);
        return;
      }
      const monthsPayload = (await monthsRes.json()) as { monthKeys?: string[] };
      const monthKeys = (monthsPayload.monthKeys ?? []).filter(Boolean);
      if (monthKeys.length === 0 || cancelled) return;

      const monthResults: Array<{ monthKey: string; payload: HomePreviousDaysData }> = [];
      await runBatched(monthKeys, async (monthKey) => {
        const payload: HomePreviousDaysData = await queryClient.fetchQuery({
          queryKey: queryKeys.home.previousDays(monthKey, cacheUserId),
          queryFn: () => fetchHomePreviousDaysData(monthKey),
          staleTime: HOME_PREVIOUS_DAYS_STALE_MS,
          gcTime: HOME_PREVIOUS_DAYS_GC_MS,
        });
        monthResults.push({ monthKey, payload });
      });
      if (cancelled || monthResults.length === 0) return;

      const allPreviousDays = monthResults.flatMap((entry) => entry.payload.previousDays ?? []);
      const allInProgress = monthResults.reduce<Record<string, InProgressProgress>>(
        (acc, entry) => mergeInProgressByGameId(acc, entry.payload.inProgressByGameId),
        {}
      );

      setInProgressByGameId((prevInProgress) => {
        const mergedInProgress = mergeInProgressByGameId(prevInProgress, allInProgress);
        primeHomeDayStatusCache(queryClient, allPreviousDays, mergedInProgress);
        setPreviousDaysMerged((prev) => {
          const merged = mergePreviousDays(prev, allPreviousDays);
          const previousAll =
            queryClient.getQueryData<HomePreviousDaysData>(
              queryKeys.home.previousDaysAll(cacheUserId)
            );
          queryClient.setQueryData(queryKeys.home.previousDaysAll(cacheUserId), {
            previousDays: merged,
            userId: previousAll?.userId ?? resolvedUserId ?? null,
            month: previousAll?.month ?? currentMonthKey,
            nextMonth: null,
            hasMoreOlder: false,
            inProgressByGameId: mergedInProgress,
          } satisfies HomePreviousDaysData);
          return merged;
        });
        return mergedInProgress;
      });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    previousDaysData?.nextMonth,
    previousDaysData?.hasMoreOlder,
    queryClient,
    resolvedUserId,
    cacheUserId,
    currentMonthKey,
    router,
  ]);

  useEffect(() => {
    router.prefetch("/play");
  }, [router]);

  /** Prefetch secuencial del mes en curso: día actual primero, luego del más reciente al más antiguo. */
  useEffect(() => {
    if (!todayData || !previousDaysData || eagerPrefetchGameIds.length === 0) return;

    let cancelled = false;
    const run = async () => {
      /**
       * Aquí NO se hace `router.prefetch("/play/<id>")`. De eso se encarga
       * `PrefetchPlayOnVisible` cuando la tarjeta entra en el viewport, más su hover y focus.
       * Tenerlo en los dos sitios hacía que cada ruta se pidiera dos veces: 62 peticiones RSC
       * para 31 rutas en una carga de la home, medido con Playwright.
       *
       * Y para el reto de hoy era inútil de todas formas: se juega en `/play`, sin id.
       */
      for (const gameId of eagerPrefetchGameIds) {
        if (cancelled) break;
        if (cacheUserId) {
          if (!prefetchedProgressIdsRef.current.has(gameId)) {
            prefetchedProgressIdsRef.current.add(gameId);
            await prefetchGameProgressById(queryClient, gameId).catch(() => undefined);
          }
          await prefetchHomeDayStatusById(queryClient, gameId).catch(() => undefined);
        } else {
          await prefetchHomeDayStatusById(queryClient, gameId).catch(() => undefined);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    todayData,
    previousDaysData,
    eagerPrefetchGameIds,
    queryClient,
    router,
    cacheUserId,
  ]);

  const prefetchedNextRef = useRef<HomeData | null>(null);
  const hasPrefetchedRef = useRef(false);

  const handleCountdownUnder10s = useCallback(() => {
    if (hasPrefetchedRef.current) return;
    hasPrefetchedRef.current = true;
    const effectiveDate = getTomorrowMadridDate();
    fetch(`/api/home?effectiveDate=${encodeURIComponent(effectiveDate)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: HomeData | null) => {
        if (payload) prefetchedNextRef.current = payload;
      })
      .catch(() => {});
  }, []);

  const handleCountdownZero = useCallback(() => {
    if (prefetchedNextRef.current) {
      const payload = prefetchedNextRef.current;
      const monthKey = getMadridDate().slice(0, 7);
      const uid = payload.userId;
      queryClient.setQueryData(queryKeys.home.all(uid), payload);
      queryClient.setQueryData(queryKeys.home.today(uid), {
        todaysGame: payload.todaysGame,
        todaysCompletedResult: payload.todaysCompletedResult ?? null,
        todaysInProgress: payload.todaysGame
          ? (payload.inProgressByGameId?.[payload.todaysGame.id] ?? null)
          : null,
        userId: payload.userId,
      });
      const prevBlock: HomePreviousDaysData = {
        previousDays: payload.previousDays,
        userId: payload.userId,
        month: monthKey,
        nextMonth: null,
        hasMoreOlder: false,
        inProgressByGameId: payload.inProgressByGameId,
      };
      queryClient.setQueryData(
        queryKeys.home.previousDays(monthKey, uid),
        prevBlock
      );
      queryClient.setQueryData(queryKeys.home.previousDaysAll(uid), prevBlock);
      primeHomeDayStatusCache(
        queryClient,
        payload.previousDays,
        payload.inProgressByGameId
      );
      setInProgressByGameId(payload.inProgressByGameId ?? {});
      if (payload.userId) {
        queryClient.setQueryData(queryKeys.home.userStats(payload.userId), {
          userStats: payload.userStats,
          rankingRanks: payload.rankingRanks,
          rankingStats: payload.rankingStats,
          userId: payload.userId,
        });
      }
      prefetchedNextRef.current = null;
      // No refetch: la respuesta podría ser del día anterior y sobrescribiría la UI correcta.
    } else {
      refetchToday();
      refetchPreviousDays();
    }
  }, [queryClient, refetchToday, refetchPreviousDays]);

  const todaysGame = todayData?.todaysGame ?? null;
  const userId = resolvedUserId;
  const previousDays = previousDaysMerged;
  const todaysCompletedResult = todaysCompletedResultEffective;
  const rankingStats = homeUserStatsData?.rankingStats;

  const t = useTranslations("home");
  const locale = useLocale();
  const { byGameId, saveProgress } = useGameProgressStore();

  // Sincronizar progreso en curso del servidor al store (solo invitados; autenticados usan inProgressByGameId directamente)
  useEffect(() => {
    if (userId || !todaysServerInProgressEffective) return;
    for (const prog of [todaysServerInProgressEffective]) {
      const full: GameProgress = {
        ...prog,
        played: false,
        won: false,
        score: null,
      };
      saveProgress(full);
    }
  }, [userId, todaysServerInProgressEffective, saveProgress]);

  // Hoy: servidor (inProgressByGameId) tiene prioridad para usuarios autenticados
  const todaysLocalOrServer = todaysGame
    ? (userId && todaysServerInProgressEffective
        ? todaysServerInProgressEffective
        : byGameId[todaysGame.id])
    : undefined;
  const todaysProgress = todaysLocalOrServer as GameProgress | undefined;
  const todaysCompleted =
    (todaysProgress && (todaysProgress.phase === "won" || todaysProgress.phase === "lost")) || !!todaysCompletedResult;
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
    sessionStorage.setItem("ecos_play_nav_start_ms", String(performance.now()));
    sessionStorage.setItem("ecos_play_from_home", "1");
    sessionStorage.setItem(PLAY_SKELETON_VARIANT_KEY, variant);
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
    const tg = todayData?.todaysGame ?? initialData?.todaysGame;
    if (!tg?.id) return;
    router.prefetch("/play");
    if (cacheUserId) {
      void prefetchGameProgressById(queryClient, tg.id).catch(() => undefined);
    }
    void prefetchHomeDayStatusById(queryClient, tg.id).catch(() => undefined);
  }, [
    todayData?.todaysGame,
    initialData?.todaysGame,
    router,
    queryClient,
    cacheUserId,
  ]);

  const handleShareHome = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const url = locale === "en" ? `${base}/en` : `${base}/`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "ECOS",
          text: "Adivina la canción del día - ECOS",
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
  if (
    (isTodayPending || isPreviousDaysPending) &&
    !todayData &&
    !previousDaysData
  ) {
    return <HomeSkeleton />;
  }

  const todayDate = todaysGame?.date ?? getEffectiveGameDate();

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
            onCountdownUnder10s={handleCountdownUnder10s}
            onCountdownZero={handleCountdownZero}
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
            ? {
                date: todaysGame.date,
                completed: todaysCompleted,
                won: todaysWon === true,
                inProgress: todaysInProgress,
              }
            : null
        }
        onPlayToday={navigateToPlayToday}
      />
    </div>
  );
}
