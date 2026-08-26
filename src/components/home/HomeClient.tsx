"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { useLocale } from "next-intl";
import {
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
  useSubmitFeedbackMutation,
  HOME_PREVIOUS_DAYS_GC_MS,
  HOME_PREVIOUS_DAYS_STALE_MS,
  type HomeData,
  type HomeTodayData,
  type InProgressProgress,
  type HomePreviousDaysData,
} from "@/lib/hooks/queries";
import type { PreviousDayGame, GameWithSong } from "@/lib/queries/games";
import { cn } from "@/lib/utils";
import { HomeSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useRouter } from "@/i18n/navigation";
import {
  ABOUT_HOW_TO_PLAY_ICONS,
  HOME_EAGER_PREFETCH_MAX,
  HOME_PREFETCH_STRATEGY,
  MAX_PREFETCH_HISTORY_MONTHS_SAFETY,
  mergeInProgressByGameId,
  mergeInProgressPreferringMoreGuesses,
  mergePreviousDays,
  runBatched,
  titleCaseWords,
} from "@/components/home/homeHelpers";
import { Countdown } from "@/components/home/HomeCountdown";
import { HomeStatsCarousel } from "@/components/home/HomeStats";
import { PreviousDaysSection } from "@/components/home/PreviousDaysSection";
import {
  HeaderBrandWaveform,
  WaveformBars,
} from "@/components/home/HomeWaveform";
import { useAuthStore } from "@/lib/store/authStore";
import {
  PLAY_SKELETON_VARIANT_KEY,
  type PlaySkeletonVariant,
} from "@/lib/navigation/playSkeletonStorage";
import { PLAY_NAVIGATION_START_EVENT } from "@/lib/navigation/playNavigationEvents";
import { consumeHomeSyncSignal } from "@/lib/consistencySync";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";

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

/** Alineado con `duration-200` del Dialog; evita flash del formulario durante la animación de cierre. */
const REPORT_FEEDBACK_DIALOG_EXIT_MS = 250;

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
  const tc = useTranslations("common");
  const howToPlaySteps = t.raw("howToPlayStepsList") as { title: string; desc: string }[];
  const locale = useLocale();
  const { dateFnsLocale, formatNumber } = useAppFormatters();
  const { byGameId, saveProgress } = useGameProgressStore();

  const [reportOpen, setReportOpen] = useState(false);
  const [reportType, setReportType] = useState<"bug" | "error" | "suggestion">("bug");
  const [reportMessage, setReportMessage] = useState("");
  const [reportEmail, setReportEmail] = useState("");
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const reportStatusResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitFeedback = useSubmitFeedbackMutation();

  const handleReportSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const message = reportMessage.trim();
      if (!message) return;
      setReportStatus("sending");
      submitFeedback.mutate(
        {
          type: reportType,
          message,
          email: reportEmail.trim() || undefined,
        },
        {
          onSuccess: () => {
            setReportStatus("success");
            setReportMessage("");
            setReportEmail("");
          },
          onError: () => {
            setReportStatus("error");
          },
        }
      );
    },
    // Los setters de useState son estables; van declarados porque el compilador
    // los infiere como dependencias y si no coinciden descarta la optimización.
    [reportType, reportMessage, reportEmail, submitFeedback, setReportMessage, setReportEmail]
  );

  const handleReportOpenChange = useCallback((open: boolean) => {
    if (reportStatusResetTimeoutRef.current !== null) {
      clearTimeout(reportStatusResetTimeoutRef.current);
      reportStatusResetTimeoutRef.current = null;
    }
    setReportOpen(open);
    if (open) {
      setReportStatus("idle");
    } else {
      reportStatusResetTimeoutRef.current = setTimeout(() => {
        reportStatusResetTimeoutRef.current = null;
        setReportStatus("idle");
      }, REPORT_FEEDBACK_DIALOG_EXIT_MS);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (reportStatusResetTimeoutRef.current !== null) {
        clearTimeout(reportStatusResetTimeoutRef.current);
      }
    };
  }, []);

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

  const headerActionButtonClass =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center gap-0 rounded-xl border border-border bg-muted px-0 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground min-[415px]:h-9 min-[415px]:w-auto min-[415px]:max-w-[min(100%,11rem)] min-[415px]:justify-start min-[415px]:gap-1.5 min-[415px]:px-2.5 min-[415px]:text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const headerInfoButtonClass =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center gap-0 rounded-xl border border-border bg-muted px-0 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground min-[348px]:w-auto min-[348px]:max-w-[min(100%,11rem)] min-[348px]:justify-start min-[348px]:gap-1.5 min-[348px]:px-2.5 min-[348px]:text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="flex min-h-full min-w-0 flex-col gap-5 px-4 pb-6">
      {/* Header + Hero más compactos */}
      <div className="flex flex-col gap-1">
      <header className="sticky top-0 z-30 -mx-4 flex items-center justify-between px-4 py-3 backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--background) 85%, transparent)" }}>
        <div className="flex min-w-0 flex-1 items-center gap-2 pr-2 sm:pr-3">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand/15 ring-1 ring-brand/30">
            <Image
              src="/ecos_icon_v2_192.png"
              alt=""
              width={36}
              height={36}
              className="object-contain"
              sizes="36px"
            />
          </div>
          <span className="shrink-0 text-lg font-bold leading-none tracking-tight">{tc("appName")}</span>
          <HeaderBrandWaveform />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 min-[415px]:gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <button type="button" className={headerInfoButtonClass} aria-label={t("aboutTitle")}>
                <span aria-hidden className="material-symbols-outlined shrink-0 text-lg text-brand/70 min-[348px]:text-xl">info</span>
                <span className="hidden truncate min-[348px]:inline">{t("headerInfoButton")}</span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md gap-0 overflow-y-auto sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("aboutTitle")}</DialogTitle>
                <DialogDescription className="sr-only">{t("aboutAccessibilitySummary")}</DialogDescription>
              </DialogHeader>
              <div className="mt-3 space-y-5">
                <div className="rounded-xl border border-brand/25 bg-gradient-to-br from-brand/12 to-brand/5 px-3.5 py-3">
                  <p className="text-sm font-semibold leading-snug text-brand">{t("aboutTagline")}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("aboutBody")}</p>
                </div>
                <div>
                  <h4 className="mb-3 text-sm font-semibold tracking-tight">{t("howToPlayTitle")}</h4>
                  <ul className="space-y-2" role="list">
                    {howToPlaySteps.map((step, i) => (
                      <li
                        key={i}
                        className="flex gap-3 rounded-xl border border-border/60 bg-muted/40 px-2.5 py-2.5"
                      >
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand ring-1 ring-brand/25"
                          aria-hidden
                        >
                          <span aria-hidden
                            className="material-symbols-outlined text-[22px]"
                            style={{ fontVariationSettings: "'FILL' 1, 'wght' 500" }}
                          >
                            {ABOUT_HOW_TO_PLAY_ICONS[i] ?? "music_note"}
                          </span>
                        </span>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <p className="text-sm font-medium leading-snug text-foreground">{step.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.desc}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={reportOpen} onOpenChange={handleReportOpenChange}>
            <DialogTrigger asChild>
              <button type="button" className={headerActionButtonClass} aria-label={t("reportTitle")}>
                <span aria-hidden className="material-symbols-outlined shrink-0 text-lg text-brand/70 min-[415px]:text-xl">bug_report</span>
                <span className="hidden truncate min-[415px]:inline">{t("headerReportButton")}</span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{t("reportTitle")}</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
                  {t("reportDescription")}
                </DialogDescription>
              </DialogHeader>
              {reportStatus === "success" ? (
                <p className="text-sm font-medium text-brand">{t("reportSuccess")}</p>
              ) : (
                <form onSubmit={handleReportSubmit} className="mt-4 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">{t("reportType")}</label>
                    <Select value={reportType} onValueChange={(v) => setReportType(v as "bug" | "error" | "suggestion")}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bug">{t("reportTypeBug")}</SelectItem>
                        <SelectItem value="error">{t("reportTypeError")}</SelectItem>
                        <SelectItem value="suggestion">{t("reportTypeSuggestion")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">{t("reportMessage")}</label>
                    <textarea
                      value={reportMessage}
                      onChange={(e) => setReportMessage(e.target.value)}
                      placeholder={t("reportMessagePlaceholder")}
                      required
                      rows={3}
                      maxLength={2000}
                      className={cn(
                        "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 placeholder:text-muted-foreground disabled:opacity-50",
                        "min-h-[72px] resize-y"
                      )}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground">{t("reportEmail")}</label>
                    <Input
                      type="email"
                      value={reportEmail}
                      onChange={(e) => setReportEmail(e.target.value)}
                      placeholder={t("reportEmailPlaceholder")}
                      className="w-full"
                    />
                  </div>
                  {reportStatus === "error" && (
                    <p className="text-sm text-destructive">{t("reportError")}</p>
                  )}
                  <Button type="submit" className="w-full" disabled={submitFeedback.isPending}>
                    {submitFeedback.isPending ? t("reportSending") : t("reportSubmit")}
                  </Button>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Today's Challenge Hero */}
      <section>
        <div className="mb-3 flex justify-center">
          <Countdown
            t={t}
            onCountdownUnder10s={handleCountdownUnder10s}
            onCountdownZero={handleCountdownZero}
          />
        </div>

        {/* Contenedor estático: en iOS Safari, transform (p. ej. whileTap) en el mismo nodo que
            rounded + overflow-hidden rompe el recorte; el motion.div va dentro sin border-radius en el padre animado */}
        <div
          className="relative cursor-pointer overflow-hidden rounded-2xl border border-white/[0.08]"
        >
          <motion.div
            role="button"
            tabIndex={0}
            whileTap={{ scale: 0.99 }}
            onMouseEnter={prefetchTodayPlay}
            onFocus={prefetchTodayPlay}
            onClick={navigateToPlayToday}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                navigateToPlayToday();
              }
            }}
            className="flex w-full flex-col origin-center will-change-transform"
          >
            {/* Imagen */}
            <div className="relative overflow-hidden" style={{ aspectRatio: "2 / 1" }}>
              {todaysCompleted && heroBackdropUrl ? (
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `url(${heroBackdropUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
              ) : (
                <div className="absolute inset-0 bg-card dark:bg-[#0a0f0c]" />
              )}

              <div
                className="absolute inset-0 opacity-10 pointer-events-none bg-repeat"
                style={{
                  backgroundImage: "url('https://www.transparenttextures.com/patterns/stardust.png')",
                }}
              />

              {/* Scrim suave: solo para que el badge respire arriba */}
              <div
                className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/0 to-black/20 dark:from-black/35 dark:via-black/0 dark:to-transparent"
                aria-hidden
              />

              {/* Badge (único overlay informativo) */}
              <div className="absolute right-4 top-4">
                <TodaysCardBadge
                  todaysCompleted={todaysCompleted}
                  todaysInProgress={todaysInProgress}
                  todaysWon={todaysWon}
                  t={t}
                />
              </div>

              {/* Waveform decorativa (se mantiene en la parte superior cuando NO está completado) */}
              {!todaysCompleted && <WaveformBars />}
            </div>

            {/* Panel inferior sólido (info + acciones) */}
            <div className="relative border-t border-border bg-card px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                {/* Fecha + game number */}
                <p className="min-w-0 text-[10px] font-bold tracking-widest text-muted-foreground">
                  {titleCaseWords(format(new Date(), "EEE", { locale: dateFnsLocale }))}{" "}
                  <span className="opacity-60">|</span>{" "}
                  {titleCaseWords(format(new Date(), "d MMM", { locale: dateFnsLocale }))}
                  {todaysGame?.game_number != null && (
                    <>
                      <span className="opacity-60"> | </span>
                      <span className="tabular-nums">#{todaysGame.game_number}</span>
                    </>
                  )}
                </p>

                {/* Puntuación (arriba derecha) cuando completado */}
                {todaysCompleted ? (
                  <div className="flex shrink-0 items-center gap-2 text-xs font-semibold">
                    <span
                      className={cn(
                        todaysDisplayScore === 0 ? "text-destructive dark:text-[color:var(--ecos-bright-destructive)]" : "text-brand dark:text-[color:var(--ecos-bright-brand)]"
                      )}
                    >
                      {t("score")}:
                    </span>
                    <span
                      className={cn(
                        todaysDisplayScore === 0 ? "text-destructive dark:text-[color:var(--ecos-bright-destructive)]" : "text-brand dark:text-[color:var(--ecos-bright-brand)]"
                      )}
                    >
                      {formatNumber(todaysDisplayScore ?? 0)}{" "}
                      {tc("points")}
                    </span>
                  </div>
                ) : null}

                {/* Progreso a la derecha (solo si está en curso) */}
                {!todaysCompleted && todaysInProgress && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      {t("progress")}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            i < todaysGuesses.length
                              ? "bg-destructive dark:bg-[var(--ecos-bright-destructive)]"
                              : i === todaysGuesses.length
                                ? "bg-muted-foreground/70 dark:bg-foreground/80"
                                : "bg-muted-foreground/45 dark:bg-white/40"
                          )}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {todaysCompleted ? (
                <>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <h3
                        className="max-w-full text-pretty text-[1.1rem] font-bold leading-snug text-foreground line-clamp-2"
                        title={todaysDisplayTitle || undefined}
                      >
                        {todaysDisplayTitle || "—"}
                      </h3>
                      {todaysDisplayArtist && (
                        <p className="mt-1 max-w-full text-[0.95rem] text-muted-foreground line-clamp-2">
                          {todaysDisplayArtist}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleShareHome}
                      aria-label={tc("share")}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-white/90 text-accent-foreground shadow-md transition-all hover:bg-white hover:opacity-90 hover:shadow-lg active:scale-95 dark:bg-accent dark:hover:bg-accent/80"
                    >
                      <span aria-hidden
                        className="material-symbols-outlined text-lg text-[color:var(--brand)]"
                        style={{ fontVariationSettings: "'FILL' 0" }}
                      >
                        share
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-3 flex items-center justify-between gap-2 sm:gap-3">
                    <div
                      className="flex w-fit items-center justify-center gap-2 rounded-xl px-5 py-2 text-base font-bold text-primary-foreground shadow-[0_0_20px_-4px_color-mix(in_srgb,var(--brand)_40%,transparent)]"
                      style={{
                        background:
                          "linear-gradient(135deg, var(--brand) 0%, var(--brand-dim) 50%, var(--brand) 100%)",
                      }}
                    >
                      <span aria-hidden
                        className="material-symbols-outlined text-lg text-primary-foreground"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        play_arrow
                      </span>
                      {t("playNow")}
                    </div>

                    <button
                      type="button"
                      onClick={handleShareHome}
                      aria-label={tc("share")}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-white/90 text-accent-foreground shadow-md transition-all hover:bg-white hover:opacity-90 hover:shadow-lg active:scale-95 dark:bg-accent dark:hover:bg-accent/80"
                    >
                      <span aria-hidden
                        className="material-symbols-outlined text-lg text-[color:var(--brand)]"
                        style={{ fontVariationSettings: "'FILL' 0" }}
                      >
                        share
                      </span>
                    </button>
                  </div>

                </>
              )}
            </div>
          </motion.div>
        </div>
      </section>
      </div>

      {/* Stats por período: carrusel Global / Semanal / Mensual (bucle infinito) */}
      {userId && rankingStats ? (
        <HomeStatsCarousel rankingStats={rankingStats} t={t} tc={tc} />
      ) : userId ? (
        <section className="grid grid-cols-2 gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </section>
      ) : (
        /* Invitado: CTA motivacional para registrarse */
        <section>
          <Link
            href="/login"
            className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 transition-colors active:bg-card/70"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand/15">
              <span aria-hidden
                className="material-symbols-outlined text-xl text-brand"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                person_add
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("guestBannerTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("guestBannerDescription")}
              </p>
            </div>
            <span aria-hidden className="material-symbols-outlined text-brand">chevron_right</span>
          </Link>
        </section>
      )}

      {/* Días anteriores */}
      <PreviousDaysSection
        previousDays={previousDays}
        userId={userId}
        inProgressByGameId={inProgressByGameId}
        onNavigateToGame={markPlayNavigationStart}
      />
    </div>
  );
}

function TodaysCardBadge({
  todaysCompleted,
  todaysInProgress,
  todaysWon,
  t,
}: {
  todaysCompleted: boolean;
  todaysInProgress: boolean;
  todaysWon?: boolean;
  t: (key: string) => string;
}) {
  const baseClass = "inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-md";

  const dotColor = todaysCompleted
    ? todaysWon
      ? "bg-[var(--ecos-bright-brand)]"
      : "bg-[var(--ecos-bright-destructive)]"
    : todaysInProgress
      ? "bg-orange-500"
      : "bg-blue-500";

  if (todaysCompleted) {
    const isWon = todaysWon === true;
    return (
      <div className={baseClass}>
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full animate-pulse", dotColor)}
          style={{ animationDuration: "2s" }}
        />
        <span
          className={
            isWon ? "text-[color:var(--ecos-bright-brand)]" : "text-[color:var(--ecos-bright-destructive)]"
          }
        >
          {isWon ? t("badgeWon") : t("badgeLost")}
        </span>
      </div>
    );
  }

  if (todaysInProgress) {
    return (
      <div className={baseClass}>
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full animate-pulse", dotColor)}
          style={{ animationDuration: "2s" }}
        />
        {t("badgeInProgress")}
      </div>
    );
  }

  return (
    <div className={baseClass}>
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full animate-pulse", dotColor)}
        style={{ animationDuration: "2s" }}
      />
      {t("badgeNotPlayed")}
    </div>
  );
}
