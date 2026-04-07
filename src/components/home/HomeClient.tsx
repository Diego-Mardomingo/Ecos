"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { es, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";
import {
  getMadridDate,
  getMsUntilNextMidnightMadrid,
  getTomorrowMadridDate,
} from "@/lib/date-utils";
import { useGameProgressStore, type GameProgress } from "@/lib/store/gameProgressStore";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  useHomeToday,
  useHomePreviousDays,
  useHomeUserStats,
  queryKeys,
  fetchHomePreviousDaysData,
  HOME_DAY_STATUS_STALE_MS,
  HOME_PREVIOUS_DAYS_GC_MS,
  HOME_PREVIOUS_DAYS_STALE_MS,
  type HomeData,
  type HomeDayStatusData,
  type HomePreviousDaysData,
} from "@/lib/hooks/queries";
import type { PreviousDayGame } from "@/lib/queries/games";
import { cn } from "@/lib/utils";
import { HomeSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuthStore } from "@/lib/store/authStore";

/** Iconos Material para los pasos del diálogo «Cómo se juega» (mismo orden que `howToPlayStepsList` en i18n). */
const ABOUT_HOW_TO_PLAY_ICONS = [
  "calendar_today",
  "graphic_eq",
  "search",
  "emoji_events",
  "skip_next",
] as const;

const PREVIOUS_DAYS_FILTER_STORAGE_KEY = "ecos-previous-days-filter";
const HOME_MONTHS_OPEN_STORAGE_KEY = "ecos-home-months-open";
const HOME_VIEW_MODE_STORAGE_KEY = "ecos-home-view-mode";
const HOME_SORT_ORDER_STORAGE_KEY = "ecos-home-sort-order";
const HOME_STATS_PERIOD_STORAGE_KEY = "ecos-home-stats-period";
/**
 * Solo red de seguridad si la API devolviera nextMonth de forma errónea.
 * El histórico real termina cuando nextMonth es null.
 */
const MAX_PREFETCH_HISTORY_MONTHS_SAFETY = 600;
/** Colores para días anteriores en orden: rojo, azul, verde (bucle) */
const PREVIOUS_DAY_COLORS = [
  "hsl(0, 55%, 40%)",   /* rojo */
  "hsl(200, 50%, 40%)", /* azul */
  "hsl(140, 45%, 35%)", /* verde */
] as const;

function previousMonthKey(monthKey: string): string | null {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const prevDate = new Date(Date.UTC(y, m - 2, 1));
  return `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function mergePreviousDays(
  current: PreviousDayGame[],
  incoming: PreviousDayGame[]
): PreviousDayGame[] {
  if (incoming.length === 0) return current;
  const map = new Map<string, PreviousDayGame>();
  for (const day of current) map.set(day.id, day);
  for (const day of incoming) map.set(day.id, day);
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function previousDayColor(gameNumber: number): string {
  return PREVIOUS_DAY_COLORS[(gameNumber - 1) % 3];
}

interface Props {
  initialData?: {
    todaysGame: import("@/lib/queries/games").GameWithSong | null;
    userStats: import("@/lib/queries/users").UserStats | null;
    userId: string | null;
    previousDays: PreviousDayGame[];
    inProgressByGameId?: Record<string, import("@/lib/hooks/queries").InProgressProgress>;
    todaysCompletedResult?: import("@/lib/hooks/queries").TodaysCompletedResult | null;
    rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
    rankingStats?: HomeData["rankingStats"];
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
          nextMonth: previousMonthKey(currentMonthKey),
          hasMoreOlder: true,
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
  const prefetchStartedRef = useRef(false);

  useEffect(() => {
    if (!previousDaysData?.previousDays) return;
    setPreviousDaysMerged((prev) => {
      const merged = mergePreviousDays(prev, previousDaysData.previousDays);
      queryClient.setQueryData(queryKeys.home.previousDaysAll(cacheUserId), {
        previousDays: merged,
        userId: previousDaysData.userId ?? resolvedUserId ?? null,
        month: previousDaysData.month,
        nextMonth: previousDaysData.nextMonth ?? null,
        hasMoreOlder: previousDaysData.hasMoreOlder,
      } satisfies HomePreviousDaysData);
      return merged;
    });
  }, [previousDaysData, queryClient, resolvedUserId, cacheUserId]);

  useEffect(() => {
    if (prefetchStartedRef.current) return;
    const startMonth = previousDaysData?.nextMonth ?? null;
    if (!startMonth) return;
    prefetchStartedRef.current = true;

    let cancelled = false;
    const run = async () => {
      let monthCursor: string | null = startMonth;
      let count = 0;
      while (
        !cancelled &&
        monthCursor &&
        count < MAX_PREFETCH_HISTORY_MONTHS_SAFETY
      ) {
        try {
          const payload: HomePreviousDaysData = await queryClient.fetchQuery({
            queryKey: queryKeys.home.previousDays(monthCursor!, cacheUserId),
            queryFn: () => fetchHomePreviousDaysData(monthCursor!),
            staleTime: HOME_PREVIOUS_DAYS_STALE_MS,
            gcTime: HOME_PREVIOUS_DAYS_GC_MS,
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
            } satisfies HomePreviousDaysData);
            return merged;
          });
          monthCursor = payload.nextMonth ?? null;
        } catch {
          break;
        }
        count += 1;
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [previousDaysData?.nextMonth, queryClient, resolvedUserId, cacheUserId]);
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
        nextMonth: previousMonthKey(monthKey),
        hasMoreOlder: true,
      };
      queryClient.setQueryData(
        queryKeys.home.previousDays(monthKey, uid),
        prevBlock
      );
      queryClient.setQueryData(queryKeys.home.previousDaysAll(uid), prevBlock);
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
  const todaysServerInProgress = todayData?.todaysInProgress ?? null;
  const todaysCompletedResult = todayData?.todaysCompletedResult ?? null;
  const rankingStats = homeUserStatsData?.rankingStats;

  const t = useTranslations("home");
  const tc = useTranslations("common");
  const howToPlaySteps = t.raw("howToPlayStepsList") as { title: string; desc: string }[];
  const locale = useLocale();
  const dateFnsLocale = locale === "es" ? es : enUS;
  const { byGameId, saveProgress } = useGameProgressStore();

  const [reportOpen, setReportOpen] = useState(false);
  const [reportType, setReportType] = useState<"bug" | "error" | "suggestion">("bug");
  const [reportMessage, setReportMessage] = useState("");
  const [reportEmail, setReportEmail] = useState("");
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const reportStatusResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleReportSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const message = reportMessage.trim();
      if (!message) return;
      setReportStatus("sending");
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: reportType,
            message,
            email: reportEmail.trim() || undefined,
          }),
        });
        if (!res.ok) throw new Error("Failed");
        setReportStatus("success");
        setReportMessage("");
        setReportEmail("");
      } catch {
        setReportStatus("error");
      }
    },
    [reportType, reportMessage, reportEmail]
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
    if (userId || !todaysServerInProgress) return;
    for (const prog of [todaysServerInProgress]) {
      const full: GameProgress = {
        ...prog,
        played: false,
        won: false,
        score: null,
      };
      saveProgress(full);
    }
  }, [userId, todaysServerInProgress, saveProgress]);

  // Hoy: servidor (inProgressByGameId) tiene prioridad para usuarios autenticados
  const todaysLocalOrServer = todaysGame
    ? (userId && todaysServerInProgress
        ? todaysServerInProgress
        : byGameId[todaysGame.id])
    : undefined;
  const todaysProgress = todaysLocalOrServer as GameProgress | undefined;
  const todaysCompleted =
    (todaysProgress && (todaysProgress.phase === "won" || todaysProgress.phase === "lost")) || !!todaysCompletedResult;
  const todaysDisplayCover = todaysCompleted
    ? (todaysCompletedResult?.cover_url ?? todaysProgress?.cover_url ?? todaysGame?.ecos_songs.cover_url ?? "")
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

  return (
    <div className="flex min-h-full flex-col gap-5 px-4 pb-6">
      {/* Header + Hero más compactos */}
      <div className="flex flex-col gap-1">
      <header className="sticky top-0 z-30 -mx-4 flex items-center justify-between px-4 py-3 backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--background) 85%, transparent)" }}>
        <div className="flex items-center gap-2">
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
          <span className="text-lg font-bold tracking-tight">{tc("appName")}</span>
          <span
            className="material-symbols-outlined text-xl text-brand"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            music_note
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80" aria-label={t("aboutTitle")}>
                <span className="material-symbols-outlined text-xl">info</span>
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
                          <span
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
              <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80" aria-label={t("reportTitle")}>
                <span className="material-symbols-outlined text-xl">bug_report</span>
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
                  <Button type="submit" className="w-full" disabled={reportStatus === "sending"}>
                    {reportStatus === "sending" ? t("reportSending") : t("reportSubmit")}
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
          style={{ aspectRatio: "4/3" }}
        >
          <motion.div
            role="button"
            tabIndex={0}
            whileTap={{ scale: 0.99 }}
            onClick={() => router.push("/play")}
            onKeyDown={(e) => e.key === "Enter" && router.push("/play")}
            className="absolute inset-0 origin-center will-change-transform"
          >
          {/* Fondo: cover con blur cuando completado, sino oscuro */}
          {todaysCompleted && todaysDisplayCover ? (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${todaysDisplayCover})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(1px)",
              }}
            />
          ) : (
            <div className="absolute inset-0 bg-[#0a0f0c]" />
          )}
          {/* Efectos visuales: orbs, stardust y gradiente radial — verde si acertado, rojo si fallido */}
          <div
            className={cn(
              "absolute -top-[10%] -left-[10%] h-[60%] w-[60%] rounded-full blur-[80px] opacity-40",
              todaysCompleted && !todaysWon ? "bg-red-500/20" : "bg-brand/20"
            )}
            aria-hidden
          />
          <div
            className={cn(
              "absolute -bottom-[5%] -right-[5%] h-[50%] w-[50%] rounded-full blur-[80px] opacity-40",
              todaysCompleted && !todaysWon ? "bg-red-600/10" : "bg-emerald-600/10"
            )}
            aria-hidden
          />
          <div
            className="absolute inset-0 opacity-20 pointer-events-none bg-repeat"
            style={{ backgroundImage: "url('https://www.transparenttextures.com/patterns/stardust.png')" }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                todaysCompleted && !todaysWon
                  ? "radial-gradient(circle at 50% 0%, rgba(239, 68, 68, 0.15) 0%, rgba(10, 19, 14, 0.98) 80%)"
                  : "radial-gradient(circle at 50% 0%, rgba(43, 238, 121, 0.15) 0%, rgba(10, 19, 14, 0.98) 80%)",
            }}
          />

          {/* Esquina superior izquierda: fecha + id */}
          <div className="absolute left-4 top-4 rounded-xl bg-white/5 px-3 py-2.5 backdrop-blur-xl">
            <p
              className="text-[10px] font-bold uppercase tracking-widest text-white/60"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
            >
              {format(new Date(), "d", { locale: dateFnsLocale })}{" "}
              {format(new Date(), "MMMM", { locale: dateFnsLocale }).toUpperCase()}
              {todaysGame?.game_number != null && (
                <>
                  <span className="text-white/40"> · </span>
                  <span className="tabular-nums">#{todaysGame.game_number}</span>
                </>
              )}
            </p>
          </div>

          {/* Esquina superior derecha: badge (acertado / fallado / en curso / no jugado) */}
          <div className="absolute right-4 top-4 px-3 py-2.5">
            <TodaysCardBadge
              todaysCompleted={todaysCompleted}
              todaysInProgress={todaysInProgress}
              todaysWon={todaysWon}
              t={t}
            />
          </div>

          {/* Waveform decorativa (oculta cuando completado) */}
          {!todaysCompleted && <WaveformBars />}

          {/* Zona central: texto y progreso (entre waveform y botones) */}
          <div
            className="absolute left-0 right-0 flex flex-col items-center justify-center px-4"
            style={{ top: "50%", bottom: "5.5rem" }}
          >
            {todaysCompleted ? (
              <div className="flex flex-col items-center rounded-xl bg-white/5 px-4 py-3 backdrop-blur-xl">
                <h3
                  className="max-w-full text-center text-[1.35rem] font-bold leading-tight text-white line-clamp-2 sm:text-[1.5rem]"
                  style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" }}
                  title={todaysDisplayTitle || undefined}
                >
                  {todaysDisplayTitle || "—"}
                </h3>
                {todaysDisplayArtist && (
                  <p
                    className="mt-1 max-w-full text-center text-sm text-white/70 line-clamp-2"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" }}
                  >
                    {todaysDisplayArtist}
                  </p>
                )}
              </div>
            ) : null}
            {todaysInProgress && (
              <div className="mt-3 flex flex-col items-center gap-2">
                <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">
                  {t("progress")}
                </p>
                <div className="flex items-center justify-center gap-1.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        i < todaysGuesses.length
                          ? "bg-[var(--ecos-bright-destructive)]"
                          : i === todaysGuesses.length
                            ? "bg-white/80"
                            : "bg-white/40"
                      )}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Botones o puntuación */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              {todaysCompleted ? (
                <div className="flex w-fit items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-md">
                  <span
                    className={
                      todaysDisplayScore === 0
                        ? "text-[color:var(--ecos-bright-destructive)]"
                        : "text-[color:var(--ecos-bright-brand)]"
                    }
                  >
                    {t("score")}:
                  </span>
                  <span
                    className={
                      todaysDisplayScore === 0
                        ? "text-[color:var(--ecos-bright-destructive)]"
                        : "text-[color:var(--ecos-bright-brand)]"
                    }
                  >
                    {(todaysDisplayScore ?? 0).toLocaleString(locale === "es" ? "es" : "en-US")}{" "}
                    {tc("points")}
                  </span>
                </div>
              ) : (
                <div
                  className="flex w-fit items-center justify-center gap-2 rounded-xl px-5 py-2 text-base font-bold text-primary-foreground shadow-[0_0_20px_-4px_color-mix(in_srgb,var(--brand)_40%,transparent)]"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--brand) 0%, var(--brand-dim) 50%, var(--brand) 100%)",
                  }}
                >
                  <span
                    className="material-symbols-outlined text-lg text-primary-foreground"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    play_arrow
                  </span>
                  {t("playNow")}
                </div>
              )}
              <button
                type="button"
                onClick={handleShareHome}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#282828] text-[color:var(--ecos-bright-brand)] shadow-md transition-all hover:bg-[#383838] hover:opacity-90 hover:shadow-lg active:scale-95"
              >
                <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 0" }}>share</span>
              </button>
            </div>
          </div>
          </motion.div>
        </div>
      </section>
      </div>

      {/* Stats por período: carrusel Global / Semanal / Mensual (bucle infinito) */}
      {userId && rankingStats ? (
        <HomeStatsCarousel
          rankingStats={rankingStats}
          t={t}
          tc={tc}
          locale={locale}
        />
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
              <span
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
            <span className="material-symbols-outlined text-brand">chevron_right</span>
          </Link>
        </section>
      )}

      {/* Días anteriores */}
      <PreviousDaysSection
        previousDays={previousDays}
        userId={userId}
        inProgressByGameId={initialData?.inProgressByGameId}
        onNavigateToGame={undefined}
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

function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

const MS_PER_HOUR = 3600 * 1000;
const PREFETCH_UNDER_MS = 10_000;

function Countdown({
  t,
  onCountdownUnder10s,
  onCountdownZero,
}: {
  t: (key: string) => string;
  onCountdownUnder10s?: () => void;
  onCountdownZero?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [ms, setMs] = useState(0);
  const prevMsRef = useRef<number | null>(null);
  const hasTriggeredRef = useRef(false);
  const hasTriggeredUnder10Ref = useRef(false);

  useEffect(() => {
    setMounted(true);
    setMs(getMsUntilNextMidnightMadrid());
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const tick = () => setMs(getMsUntilNextMidnightMadrid());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (
      onCountdownUnder10s &&
      ms < PREFETCH_UNDER_MS &&
      !hasTriggeredUnder10Ref.current
    ) {
      hasTriggeredUnder10Ref.current = true;
      onCountdownUnder10s();
    }
  }, [mounted, ms, onCountdownUnder10s]);

  useEffect(() => {
    if (!mounted || !onCountdownZero || hasTriggeredRef.current) return;
    const prev = prevMsRef.current;
    prevMsRef.current = ms;
    if (prev !== null && prev < 60000 && ms > MS_PER_HOUR) {
      hasTriggeredRef.current = true;
      onCountdownZero();
    }
  }, [mounted, ms, onCountdownZero]);

  return (
    <span className="text-xs font-medium text-muted-foreground tabular-nums">
      {t("nextSongIn")} {mounted ? formatCountdown(ms) : "—"}
    </span>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    setMatches(m.matches);
    const handler = () => setMatches(m.matches);
    m.addEventListener("change", handler);
    return () => m.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function WaveformBars() {
  const isSm = useMediaQuery("(min-width: 640px)");
  const isMd = useMediaQuery("(min-width: 768px)");

  const { barCount, barWidth, heightBase, heightRange, gap } = useMemo(() => {
    if (isMd) return { barCount: 52, barWidth: 4, heightBase: 12, heightRange: 32, gap: 3 };
    if (isSm) return { barCount: 44, barWidth: 3, heightBase: 10, heightRange: 28, gap: 2.5 };
    return { barCount: 36, barWidth: 2.5, heightBase: 8, heightRange: 24, gap: 2 };
  }, [isSm, isMd]);

  const bars = useMemo(
    () =>
      Array.from({ length: barCount }, (_, i) => ({
        key: i,
        heightA: heightBase + ((i * 7) % Math.round(heightRange)),
        heightB: heightBase + ((i * 11 + 13) % Math.round(heightRange)),
        duration: 0.6 + (i % 10) * 0.08,
        delay: i * 0.02,
      })),
    [barCount, heightBase, heightRange]
  );

  return (
    <div
      className="absolute inset-x-0 top-[52%] flex -translate-y-1/2 items-center justify-center px-4 opacity-60"
      style={{ gap: `${gap}px` }}
    >
      <div
        className="flex items-center justify-center"
        style={{ gap: `${gap}px` }}
      >
      {bars.map(({ key, heightA, heightB, duration, delay }) => (
        <motion.div
          key={key}
          className="rounded-full bg-brand shrink-0"
          style={{ width: `${barWidth}px`, minWidth: `${barWidth}px` }}
          animate={{ height: [`${heightA}px`, `${heightB}px`] }}
          transition={{
            duration,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "easeInOut",
            delay,
          }}
        />
      ))}
      </div>
    </div>
  );
}

function HomeStatsCarousel({
  rankingStats,
  t,
  tc,
  locale,
}: {
  rankingStats: { global: { points: number; rank: number | null }; weekly: { points: number; rank: number | null }; monthly: { points: number; rank: number | null } };
  t: (key: string) => string;
  tc: (key: string) => string;
  locale: string;
}) {
  const [api, setApi] = useState<CarouselApi>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const periods = ["global", "weekly", "monthly"] as const;

  // Restaurar último período guardado y persistir al cambiar
  useEffect(() => {
    if (!api) return;
    const saved = typeof window !== "undefined" ? localStorage.getItem(HOME_STATS_PERIOD_STORAGE_KEY) : null;
    const idx = saved != null ? periods.indexOf(saved as (typeof periods)[number]) : -1;
    const initialIndex = idx >= 0 ? idx : 0;
    if (initialIndex !== 0) api.scrollTo(initialIndex);
    setSelectedIndex(initialIndex);
    if (typeof window !== "undefined") localStorage.setItem(HOME_STATS_PERIOD_STORAGE_KEY, periods[initialIndex]);
    api.on("select", () => {
      const i = api.selectedScrollSnap();
      setSelectedIndex(i);
      if (typeof window !== "undefined") localStorage.setItem(HOME_STATS_PERIOD_STORAGE_KEY, periods[i]);
    });
  }, [api]);

  const scrollTo = useCallback(
    (index: number) => {
      api?.scrollTo(index);
    },
    [api]
  );

  const positionIconStyle = (rank: number | null) => {
    if (rank === 1) return { iconColor: "text-amber-500", iconBg: "bg-amber-500/20" };
    if (rank === 2) return { iconColor: "text-gray-400", iconBg: "bg-gray-500/20" };
    if (rank === 3) return { iconColor: "text-[#cd7f32]", iconBg: "bg-[#cd7f32]/20" };
    return { iconColor: "text-sky-400", iconBg: "bg-sky-500/15" };
  };

  return (
    <section className="w-full px-1">
      {/* Botones de período encima de las tarjetas; último seleccionado persistido en localStorage */}
      <div className="mb-2 flex justify-center gap-1.5">
        {periods.map((period, index) => (
          <button
            key={period}
            type="button"
            onClick={() => scrollTo(index)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              selectedIndex === index
                ? "bg-brand text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {t(period === "global" ? "globalRank" : period === "weekly" ? "weeklyRank" : "monthlyRank")}
          </button>
        ))}
      </div>
      <div className="relative flex items-center">
        <Carousel
          opts={{ align: "start", loop: true }}
          setApi={setApi}
          className="relative w-full flex-1"
        >
          <CarouselContent className="-ml-3">
            {periods.map((period) => (
              <CarouselItem key={period} className="pl-3">
                <div className="grid grid-cols-2 gap-3">
                  <HomeStatCard
                    label={`${t("score")} ${t(period === "global" ? "globalRank" : period === "weekly" ? "weeklyRank" : "monthlyRank")}`}
                    value={rankingStats[period].points.toLocaleString(locale === "es" ? "es-ES" : "en-US")}
                    subLabel={tc("points")}
                    icon="emoji_events"
                    iconColor="text-brand"
                    iconBg="bg-brand/15"
                  />
                  <HomeStatCard
                    label={`${t("position")} ${t(period === "global" ? "globalRank" : period === "weekly" ? "weeklyRank" : "monthlyRank")}`}
                    value={rankingStats[period].rank != null ? `#${rankingStats[period].rank}` : "—"}
                    icon="military_tech"
                    {...positionIconStyle(rankingStats[period].rank ?? null)}
                  />
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>
    </section>
  );
}

function HomeStatCard({
  label,
  value,
  subLabel,
  icon,
  iconColor,
  iconBg,
}: {
  label: string;
  value: string;
  subLabel?: string;
  icon: string;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <div className="flex flex-col rounded-2xl bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            iconBg
          )}
        >
          <span
            className={cn("material-symbols-outlined text-base", iconColor)}
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {icon}
          </span>
        </div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <div className="flex items-end gap-1">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        {subLabel && (
          <span className="mb-0.5 text-sm text-muted-foreground">{subLabel}</span>
        )}
      </div>
    </div>
  );
}

function PreviousDaysSection({
  previousDays,
  userId,
  inProgressByGameId = {},
  onNavigateToGame,
}: {
  previousDays: PreviousDayGame[];
  userId: string | null;
  inProgressByGameId?: Record<string, import("@/lib/hooks/queries").InProgressProgress>;
  onNavigateToGame?: () => void;
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = locale === "es" ? es : enUS;
  const byGameId = useGameProgressStore((s) => s.byGameId);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [filterYear, setFilterYear] = useState<number | null>(null);
  const [filterMonth, setFilterMonth] = useState<number | null>(null);

  const [nowY, nowM] = getMadridDate().split("-").map(Number);
  const currentMonthKey = `${nowY}-${String(nowM).padStart(2, "0")}`;

  // Estado inicial igual en servidor y cliente para evitar hydration mismatch; sessionStorage se aplica en useEffect
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set([currentMonthKey]));
  const hasRestoredRef = useRef(false);

  const dayStatusQueries = useQueries({
    queries: previousDays.map((day) => {
      const [y, m] = day.date.split("-").map(Number);
      const monthKey = `${y}-${String(m).padStart(2, "0")}`;
      const visibleByFilter =
        filterYear === null && filterMonth === null
          ? openMonths.has(monthKey)
          : (filterYear === null || y === filterYear) &&
            (filterMonth === null || filterMonth === m - 1);

      return {
        queryKey: queryKeys.home.dayStatus(day.id),
        queryFn: async (): Promise<HomeDayStatusData> => {
          const res = await fetch(`/api/home/day/${day.id}/status`, {
            cache: "no-store",
          });
          if (!res.ok) throw new Error("Failed to fetch day status");
          return res.json();
        },
        staleTime: HOME_DAY_STATUS_STALE_MS,
        enabled: !!userId && visibleByFilter,
        initialData: {
          gameId: day.id,
          played: day.played,
          won: day.won,
          score: day.score,
          title: day.title,
          artist_name: day.artist_name,
          cover_url: day.cover_url,
          inProgress: inProgressByGameId?.[day.id] ?? null,
        } satisfies HomeDayStatusData,
      };
    }),
  });

  const dayStatusByGameId = useMemo(() => {
    const map = new Map<string, HomeDayStatusData>();
    previousDays.forEach((day, index) => {
      const status = dayStatusQueries[index]?.data;
      if (status) map.set(day.id, status);
    });
    return map;
  }, [previousDays, dayStatusQueries]);

  // Restaurar todo desde sessionStorage al montar (solo cliente); marcar restaurado para no pisar en los efectos de persist
  useEffect(() => {
    try {
      const sOpen = sessionStorage.getItem(HOME_MONTHS_OPEN_STORAGE_KEY);
      if (sOpen) {
        const arr = JSON.parse(sOpen) as string[];
        if (Array.isArray(arr) && arr.length > 0) setOpenMonths(new Set(arr));
      }
    } catch {
      /* ignore */
    }
    try {
      const sFilter = sessionStorage.getItem(PREVIOUS_DAYS_FILTER_STORAGE_KEY);
      if (sFilter) {
        const p = JSON.parse(sFilter) as { filterYear?: number | null; filterMonth?: number | null };
        if (typeof p.filterYear === "number") setFilterYear(p.filterYear);
        if (typeof p.filterMonth === "number") setFilterMonth(p.filterMonth);
      }
    } catch {
      /* ignore */
    }
    try {
      const sView = sessionStorage.getItem(HOME_VIEW_MODE_STORAGE_KEY);
      if (sView === "list" || sView === "grid") setViewMode(sView);
    } catch {
      /* ignore */
    }
    try {
      const sSort = sessionStorage.getItem(HOME_SORT_ORDER_STORAGE_KEY);
      if (sSort === "asc" || sSort === "desc") setSortOrder(sSort);
    } catch {
      /* ignore */
    }
    // Marcar como restaurado en el siguiente tick para que los efectos de persist no escriban con estado inicial
    const id = setTimeout(() => {
      hasRestoredRef.current = true;
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // openMonths: persistir solo cuando el usuario abre/cierra un mes (no al montar, así no pisamos lo restaurado)
  const handleOpenMonthsChange = useCallback((key: string, open: boolean) => {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      try {
        sessionStorage.setItem(HOME_MONTHS_OPEN_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Filtro año/mes, viewMode y sortOrder: solo persistir después de haber restaurado para no pisar storage al montar
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    try {
      sessionStorage.setItem(
        PREVIOUS_DAYS_FILTER_STORAGE_KEY,
        JSON.stringify({ filterYear, filterMonth })
      );
    } catch {
      /* ignore */
    }
  }, [filterYear, filterMonth]);

  // viewMode y sortOrder
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    try {
      sessionStorage.setItem(HOME_VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  useEffect(() => {
    if (!hasRestoredRef.current) return;
    try {
      sessionStorage.setItem(HOME_SORT_ORDER_STORAGE_KEY, sortOrder);
    } catch {
      /* ignore */
    }
  }, [sortOrder]);

  const monthNamesFull =
    locale === "es"
      ? ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
      : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const groupsByMonth = useMemo(() => {
    const map = new Map<string, PreviousDayGame[]>();
    for (const day of previousDays) {
      const [y, m] = day.date.split("-").map(Number);
      const key = `${y}-${String(m).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(day);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (sortOrder === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
    }
    return [...map.entries()].sort(([ka], [kb]) =>
      sortOrder === "asc" ? ka.localeCompare(kb) : kb.localeCompare(ka)
    );
  }, [previousDays, sortOrder]);

  const availableMonthYearPairs = useMemo(() => {
    return groupsByMonth.map(([key]) => {
      const [y, m] = key.split("-").map(Number);
      return { year: y, month: m - 1 };
    });
  }, [groupsByMonth]);

  const filteredGroupsByMonth = useMemo(() => {
    if (filterYear === null && filterMonth === null) return groupsByMonth;
    return groupsByMonth.filter(([key]) => {
      const [y, m] = key.split("-").map(Number);
      if (filterYear !== null && y !== filterYear) return false;
      if (filterMonth !== null && m !== filterMonth + 1) return false;
      return true;
    });
  }, [groupsByMonth, filterYear, filterMonth]);

  const availableYears = useMemo(
    () => [...new Set(availableMonthYearPairs.map((p) => p.year))].sort((a, b) => b - a),
    [availableMonthYearPairs]
  );

  const availableMonthsForYear = useMemo(() => {
    if (filterYear !== null) {
      return availableMonthYearPairs
        .filter((p) => p.year === filterYear)
        .map((p) => p.month)
        .sort((a, b) => a - b);
    }
    return [...new Set(availableMonthYearPairs.map((p) => p.month))].sort((a, b) => a - b);
  }, [availableMonthYearPairs, filterYear]);

  const renderDayCard = (day: PreviousDayGame) => {
            const status = userId ? dayStatusByGameId.get(day.id) : null;
            // Usuarios autenticados: cada tarjeta tiene su propia query por gameId.
            // Invitados: gameProgressStore local.
            const serverInProgress = userId ? status?.inProgress ?? undefined : undefined;
            const localProgress = (serverInProgress ?? byGameId[day.id]) as GameProgress | undefined;
            const played = userId ? (status?.played ?? day.played) : !!localProgress;
            const serverScore = status?.score ?? day.score;
            const serverWon = status?.won ?? day.won;
            const serverHasResult = userId && played && serverScore != null;
            const displayTitle = played ? (localProgress?.title ?? status?.title ?? day.title) : "";
            const displayCover = played ? (localProgress?.cover_url ?? status?.cover_url ?? day.cover_url) : "";
            const displayScore = played ? (serverHasResult ? serverScore : (localProgress?.score ?? serverScore)) : null;
            const won = played && (serverHasResult ? serverWon : (localProgress?.won ?? serverWon));
            const completed = played && displayScore !== null;
            const inProgress =
              !serverHasResult &&
              localProgress?.phase === "playing" &&
              (localProgress?.guesses?.length ?? 0) > 0;
            const guesses = localProgress?.guesses ?? [];
            const maxAttempts = 6;

            return (
              <Link
                key={day.id}
                href={`/play/${day.id}`}
                onClick={onNavigateToGame}
              >
                <motion.div
                  whileTap={{ scale: 0.99 }}
                  className={cn(
                    "border-0 transition-colors active:opacity-90",
                    viewMode === "list"
                      ? "flex items-center gap-3 rounded-2xl bg-card p-3 active:bg-card/70"
                      : "flex flex-col rounded-2xl bg-card active:bg-card/70"
                  )}
                >
                  {viewMode === "grid" ? (
                    /* Grid: fecha encima de la portada (centrada), portada, id debajo */
                    <div className="flex h-full flex-col rounded-2xl px-3 py-1.5">
                      <p className="mb-1.5 text-center text-[10px] text-muted-foreground">
                        {format(parseISO(day.date), "d MMM", { locale: dateFnsLocale })}
                      </p>
                      <div className="relative mb-1.5 aspect-square w-full shrink-0 overflow-hidden rounded-xl">
                        {played && displayCover ? (
                          <Image src={displayCover} alt={displayTitle || "Album"} fill className="object-cover" sizes="160px" />
                        ) : (
                          <div
                            className="flex h-full w-full items-center justify-center"
                            style={{ backgroundColor: previousDayColor(day.game_number) }}
                          >
                            <span
                              className="material-symbols-outlined text-2xl text-white/90"
                              style={{ fontVariationSettings: "'FILL' 1" }}
                            >
                              play_arrow
                            </span>
                          </div>
                        )}
                        {played && completed && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span
                              className={cn(
                                "material-symbols-outlined text-xl drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] leading-none",
                                won
                                  ? "text-[color:var(--ecos-bright-brand)]"
                                  : "text-[color:var(--ecos-bright-destructive)]"
                              )}
                              style={{ fontVariationSettings: "'FILL' 1" }}
                            >
                              {won ? "check_circle" : "cancel"}
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="text-center text-[10px] tabular-nums text-muted-foreground/70">
                        #{day.game_number}
                      </p>
                    </div>
                  ) : (
                    <>
                  {/* Miniatura: carátula real si jugado, placeholder con color estable si no */}
                  <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl">
                    {played && displayCover ? (
                      <Image src={displayCover} alt={displayTitle || "Album"} fill className="object-cover" sizes="56px" />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center"
                        style={{ backgroundColor: previousDayColor(day.game_number) }}
                      >
                        <span
                          className="material-symbols-outlined text-2xl text-white/90"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          play_arrow
                        </span>
                      </div>
                    )}
                    {played && completed && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span
                          className={cn(
                            "material-symbols-outlined text-xl drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] leading-none",
                            won
                              ? "text-[color:var(--ecos-bright-brand)]"
                              : "text-[color:var(--ecos-bright-destructive)]"
                          )}
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          {won ? "check_circle" : "cancel"}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="mb-0.5 text-xs text-muted-foreground">
                      {format(parseISO(day.date), "d MMM", { locale: dateFnsLocale })}
                      <span className="text-muted-foreground/60"> | </span>
                      <span className="tabular-nums text-muted-foreground/70">#{day.game_number}</span>
                    </p>
                    <p className="truncate font-semibold">
                      {completed ? displayTitle || "—" : t("guessTheSong")}
                    </p>
                    {completed && displayScore !== null ? (
                      <p className={cn("text-xs font-medium", displayScore === 0 ? "text-destructive" : "text-brand")}>
                        {t("score")}: {displayScore.toLocaleString(locale === "es" ? "es" : "en-US")} {tc("points")}
                      </p>
                    ) : inProgress ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        {Array.from({ length: maxAttempts }).map((_, i) => (
                            <div
                              key={i}
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                i < guesses.length
                                  ? "bg-destructive"
                                  : i === guesses.length
                                  ? "bg-muted-foreground/70"
                                  : "bg-muted-foreground/45"
                              )}
                            />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("notPlayedYet")}</p>
                    )}
                  </div>

                  <span className="material-symbols-outlined text-muted-foreground">
                    {played && completed ? "chevron_right" : "play_circle"}
                  </span>
                    </>
                  )}
                </motion.div>
              </Link>
            );
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{t("previousDays")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-9 items-center rounded-lg border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-medium transition-colors",
                viewMode === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label={t("viewList")}
            >
              <span className="material-symbols-outlined text-lg">format_list_bulleted</span>
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-medium transition-colors",
                viewMode === "grid" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label={t("viewGrid")}
            >
              <span className="material-symbols-outlined text-lg">grid_view</span>
            </button>
          </div>
          <Dialog>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/30">
              <DialogTrigger asChild>
                <button
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50",
                    filterMonth !== null || filterYear !== null ? "text-brand" : ""
                  )}
                  aria-label={t("filterByDate")}
                >
                  <span className="material-symbols-outlined text-lg">filter_list</span>
                </button>
              </DialogTrigger>
            </div>
            <DialogContent className="max-w-xs">
              <DialogHeader>
                <DialogTitle>{t("filterByDate")}</DialogTitle>
                <DialogDescription className="sr-only">{t("filterByDate")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{t("filterYear")}</label>
                  <Select
                    value={filterYear != null ? String(filterYear) : "all"}
                    onValueChange={(v) => {
                      const newYear = v === "all" ? null : Number(v);
                      setFilterYear(newYear);
                      if (newYear !== null && filterMonth !== null) {
                        const valid = availableMonthYearPairs.some(
                          (p) => p.year === newYear && p.month === filterMonth
                        );
                        if (!valid) setFilterMonth(null);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("filterAll")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("filterAll")}</SelectItem>
                      {availableYears.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{t("filterMonth")}</label>
                  <Select
                    value={filterMonth != null ? String(filterMonth) : "all"}
                    onValueChange={(v) => setFilterMonth(v === "all" ? null : Number(v))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("filterAll")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("filterAll")}</SelectItem>
                      {availableMonthsForYear.map((i) => (
                        <SelectItem key={i} value={String(i)}>
                          {monthNamesFull[i]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <button
                  onClick={() => {
                    setFilterMonth(null);
                    setFilterYear(null);
                  }}
                  className="w-full rounded-lg border border-border bg-muted/50 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                >
                  {t("resetFilter")}
                </button>
              </div>
            </DialogContent>
          </Dialog>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/30">
            <button
              onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              aria-label={sortOrder === "desc" ? t("sortDesc") : t("sortAsc")}
            >
              <span
                className={cn("material-symbols-outlined text-lg", sortOrder === "asc" && "rotate-180")}
              >
                arrow_downward
              </span>
            </button>
          </div>
        </div>
      </div>

      {previousDays.length === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t("noPreviousDays")}
        </p>
      ) : filteredGroupsByMonth.length === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t("noGamesInPeriod")}
        </p>
      ) : filteredGroupsByMonth.length === 1 ? (
        <div
          className={cn(
            "gap-2",
            viewMode === "list" ? "flex flex-col" : "grid grid-cols-4 gap-2"
          )}
        >
          {filteredGroupsByMonth[0][1].map((day) => (
            <div key={day.id}>{renderDayCard(day)}</div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredGroupsByMonth.map(([key, days]) => {
            const [y, m] = key.split("-").map(Number);
            const monthLabel = `${monthNamesFull[m - 1]} ${y}`;
            const isOpen = openMonths.has(key);
            return (
              <Collapsible
                key={key}
                open={isOpen}
                onOpenChange={(open) => handleOpenMonthsChange(key, open)}
                className="group"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left font-medium transition-colors hover:bg-muted/50"
                  >
                    <span>{monthLabel}</span>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      {t("gamesCount", { count: days.length })}
                      <span className="material-symbols-outlined text-lg transition-transform group-data-[state=open]:rotate-180">
                        expand_more
                      </span>
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div
                    className={cn(
                      "mt-2 gap-2",
                      viewMode === "list" ? "flex flex-col" : "grid grid-cols-4 gap-2"
                    )}
                  >
                    {days.map((day) => (
                      <div key={day.id}>{renderDayCard(day)}</div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}
    </section>
  );
}
