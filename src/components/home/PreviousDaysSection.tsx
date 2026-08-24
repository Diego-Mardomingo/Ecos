"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { getMadridDate } from "@/lib/date-utils";
import { useGameProgressStore } from "@/lib/store/gameProgressStore";
import {
  HOME_DAY_STATUS_STALE_MS,
  prefetchGameById,
  prefetchGameProgressById,
  prefetchHomeDayStatusById,
  queryKeys,
  type HomeDayStatusData,
} from "@/lib/hooks/queries";
import type { PreviousDayGame } from "@/lib/queries/games";
import { cn } from "@/lib/utils";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import type { PlaySkeletonVariant } from "@/lib/navigation/playSkeletonStorage";
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
import { MarqueeText } from "@/components/ui/marquee-text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { PrefetchPlayOnVisible } from "@/components/home/PrefetchPlayOnVisible";
import {
  aggregateMonthGroupStats,
  deriveHomeDayState,
  type MonthGroupStats,
} from "@/components/home/homeDayDerived";
import {
  HOME_COVER_IMAGE_PRIORITY_COUNT,
  HOME_MONTHS_OPEN_STORAGE_KEY,
  HOME_SORT_ORDER_STORAGE_KEY,
  HOME_VIEW_MODE_STORAGE_KEY,
  PREVIOUS_DAYS_FILTER_STORAGE_KEY,
  previousDayColor,
  readPreviousDaysPrefs,
  titleCaseWords,
} from "@/components/home/homeHelpers";

/**
 * Sección «Días anteriores» de la home: agrupación por meses, filtros, vista lista/cuadrícula y
 * el diálogo de cada día. Es la pieza más grande que vivía en `HomeClient`; se ha movido tal cual,
 * sin cambios de lógica.
 *
 * `MonthGroupSummaryContent` viene con ella porque todos sus usos estaban aquí.
 */

function MonthGroupSummaryContent({
  stats,
  t,
  monthLabel,
  rightSlot,
}: {
  stats: MonthGroupStats;
  t: (key: string, values?: Record<string, string | number>) => string;
  monthLabel: string;
  rightSlot?: ReactNode;
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <span className="min-w-0 shrink font-medium leading-tight">{monthLabel}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {t("monthSummaryGamesProgress", { completed: stats.completed, total: stats.totalGames })}
        </span>
        {rightSlot}
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
  onNavigateToGame?: (variant: PlaySkeletonVariant) => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { dateFnsLocale, formatNumber } = useAppFormatters();
  const byGameId = useGameProgressStore((s) => s.byGameId);

  const prefetchPlayRoute = useCallback(
    (gameId: string) => {
      router.prefetch(`/play/${gameId}`);
      if (userId) {
        void prefetchGameById(queryClient, gameId).catch(() => undefined);
        void prefetchGameProgressById(queryClient, gameId).catch(() => undefined);
      }
      void prefetchHomeDayStatusById(queryClient, gameId).catch(() => undefined);
    },
    [queryClient, router, userId]
  );
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [filterYear, setFilterYear] = useState<number | null>(null);
  const [filterMonth, setFilterMonth] = useState<number | null>(null);

  const [nowY, nowM] = getMadridDate().split("-").map(Number);
  const currentMonthKey = `${nowY}-${String(nowM).padStart(2, "0")}`;

  // Estado inicial igual en servidor y cliente para evitar hydration mismatch;
  // sessionStorage se aplica justo después de hidratar (ver bloque de restauración).
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set([currentMonthKey]));

  const mounted = useIsMounted();
  const [hasRestored, setHasRestored] = useState(false);

  // Restauración desde sessionStorage ajustando el estado durante el render, no en
  // un efecto: `mounted` es false en servidor y en el render de hidratación, así que
  // el HTML coincide, y el ajuste se aplica antes del primer pintado en cliente.
  if (mounted && !hasRestored) {
    setHasRestored(true);
    const stored = readPreviousDaysPrefs();
    if (stored.openMonths) setOpenMonths(stored.openMonths);
    if (stored.filterYear != null) setFilterYear(stored.filterYear);
    if (stored.filterMonth != null) setFilterMonth(stored.filterMonth);
    if (stored.viewMode) setViewMode(stored.viewMode);
    if (stored.sortOrder) setSortOrder(stored.sortOrder);
  }

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
    if (!hasRestored) return;
    try {
      sessionStorage.setItem(
        PREVIOUS_DAYS_FILTER_STORAGE_KEY,
        JSON.stringify({ filterYear, filterMonth })
      );
    } catch {
      /* ignore */
    }
  }, [hasRestored, filterYear, filterMonth]);

  // viewMode y sortOrder
  useEffect(() => {
    if (!hasRestored) return;
    try {
      sessionStorage.setItem(HOME_VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [hasRestored, viewMode]);

  useEffect(() => {
    if (!hasRestored) return;
    try {
      sessionStorage.setItem(HOME_SORT_ORDER_STORAGE_KEY, sortOrder);
    } catch {
      /* ignore */
    }
  }, [hasRestored, sortOrder]);

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

  const monthStatsByKey = useMemo(() => {
    const map = new Map<string, MonthGroupStats>();
    for (const [key, days] of filteredGroupsByMonth) {
      map.set(key, aggregateMonthGroupStats(days, userId, dayStatusByGameId, byGameId));
    }
    return map;
  }, [filteredGroupsByMonth, dayStatusByGameId, userId, byGameId]);

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

  const renderDayCard = (day: PreviousDayGame, coverIndex: number) => {
            const status = userId ? dayStatusByGameId.get(day.id) : null;
            const d = deriveHomeDayState(day, userId, status ?? null, byGameId);
            const {
              played,
              won,
              completed,
              inProgress,
              displayScore,
              displayTitle,
              displayCover,
              guesses,
              maxAttempts,
            } = d;

            return (
              <PrefetchPlayOnVisible
                key={day.id}
                gameId={day.id}
                onPrefetch={prefetchPlayRoute}
              >
              <Link
                href={`/play/${day.id}`}
                onClick={() =>
                  onNavigateToGame?.(completed ? "completed" : "in_progress")
                }
                onMouseEnter={() => prefetchPlayRoute(day.id)}
                onFocus={() => prefetchPlayRoute(day.id)}
                className="block w-full min-w-0"
              >
                <motion.div
                  whileTap={{ scale: 0.99 }}
                  className={cn(
                    "w-full min-w-0 border-0 transition-colors active:opacity-90",
                    viewMode === "list"
                      ? "flex items-center gap-3 rounded-2xl bg-card p-3 active:bg-card/70"
                      : "flex flex-col rounded-2xl bg-card active:bg-card/70"
                  )}
                >
                  {viewMode === "grid" ? (
                    /* Grid: fecha encima de la portada (centrada), portada, id debajo */
                    <div className="flex h-full flex-col rounded-2xl px-3 py-1.5">
                      <p className="mb-1.5 text-center text-[10px] text-muted-foreground">
                        {titleCaseWords(
                          format(parseISO(day.date), "EEE", { locale: dateFnsLocale })
                        )}
                        <span className="text-muted-foreground/60"> | </span>
                        {titleCaseWords(
                          format(parseISO(day.date), "d MMM", { locale: dateFnsLocale })
                        )}
                      </p>
                      <div className="relative mb-1.5 aspect-square w-full shrink-0 overflow-hidden rounded-xl">
                        {played && displayCover ? (
                          <Image
                            src={displayCover}
                            alt={displayTitle || "Album"}
                            fill
                            className="object-cover"
                            sizes="160px"
                            loading="eager"
                            priority={coverIndex < HOME_COVER_IMAGE_PRIORITY_COUNT}
                          />
                        ) : (
                          <div
                            className="flex h-full w-full items-center justify-center"
                            style={{ backgroundColor: previousDayColor(day.game_number) }}
                          >
                            <span aria-hidden
                              className="material-symbols-outlined text-2xl text-white/90"
                              style={{ fontVariationSettings: "'FILL' 1" }}
                            >
                              play_arrow
                            </span>
                          </div>
                        )}
                        {played && completed && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span aria-hidden
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
                      <Image
                        src={displayCover}
                        alt={displayTitle || "Album"}
                        fill
                        className="object-cover"
                        sizes="56px"
                        loading="eager"
                        priority={coverIndex < HOME_COVER_IMAGE_PRIORITY_COUNT}
                      />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center"
                        style={{ backgroundColor: previousDayColor(day.game_number) }}
                      >
                        <span aria-hidden
                          className="material-symbols-outlined text-2xl text-white/90"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          play_arrow
                        </span>
                      </div>
                    )}
                    {played && completed && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span aria-hidden
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
                      {titleCaseWords(
                        format(parseISO(day.date), "EEE", { locale: dateFnsLocale })
                      )}
                      <span className="text-muted-foreground/60"> | </span>
                      {titleCaseWords(
                        format(parseISO(day.date), "d MMM", { locale: dateFnsLocale })
                      )}
                      <span className="text-muted-foreground/60"> | </span>
                      <span className="tabular-nums text-muted-foreground/70">#{day.game_number}</span>
                    </p>
                    <MarqueeText
                      text={completed ? displayTitle || "—" : t("guessTheSong")}
                      className="font-semibold"
                    />
                    {completed && displayScore !== null ? (
                      <p className={cn("text-xs font-medium", displayScore === 0 ? "text-destructive" : "text-brand")}>
                        {t("score")}: {formatNumber(displayScore)} {tc("points")}
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

                  <span aria-hidden className="material-symbols-outlined text-muted-foreground">
                    {played && completed ? "chevron_right" : "play_circle"}
                  </span>
                    </>
                  )}
                </motion.div>
              </Link>
              </PrefetchPlayOnVisible>
            );
  };

  return (
    <section className="min-w-0">
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
              <span aria-hidden className="material-symbols-outlined text-lg">format_list_bulleted</span>
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-medium transition-colors",
                viewMode === "grid" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label={t("viewGrid")}
            >
              <span aria-hidden className="material-symbols-outlined text-lg">grid_view</span>
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
                  <span aria-hidden className="material-symbols-outlined text-lg">filter_list</span>
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
              <span aria-hidden
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
        <>
          <div className="mb-2 rounded-xl border border-border bg-card px-4 py-3">
            <MonthGroupSummaryContent
              stats={monthStatsByKey.get(filteredGroupsByMonth[0][0])!}
              t={t}
              monthLabel={(() => {
                const [oy, om] = filteredGroupsByMonth[0][0].split("-").map(Number);
                return `${monthNamesFull[om - 1]} ${oy}`;
              })()}
            />
          </div>
          <div
            className={cn(
              "min-w-0 gap-2",
              viewMode === "list" ? "flex flex-col" : "grid grid-cols-4 gap-2"
            )}
          >
            {filteredGroupsByMonth[0][1].map((day, coverIndex) => (
              <div key={day.id} className="min-w-0">{renderDayCard(day, coverIndex)}</div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          {filteredGroupsByMonth.map(([key, days]) => {
            const [y, m] = key.split("-").map(Number);
            const monthLabel = `${monthNamesFull[m - 1]} ${y}`;
            const isOpen = openMonths.has(key);
            const stats = monthStatsByKey.get(key)!;
            return (
              <Collapsible
                key={key}
                open={isOpen}
                onOpenChange={(open) => handleOpenMonthsChange(key, open)}
                className="group min-w-0"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("monthSummaryAria", {
                      month: monthLabel,
                      completed: stats.completed,
                      total: stats.totalGames,
                    })}
                    className="flex w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <MonthGroupSummaryContent
                      stats={stats}
                      t={t}
                      monthLabel={monthLabel}
                      rightSlot={
                        <span aria-hidden className="material-symbols-outlined shrink-0 text-lg text-muted-foreground transition-transform group-data-[state=open]:rotate-180">
                          expand_more
                        </span>
                      }
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div
                    className={cn(
                      "mt-2 min-w-0 gap-2",
                      viewMode === "list" ? "flex flex-col" : "grid grid-cols-4 gap-2"
                    )}
                  >
                    {days.map((day, coverIndex) => (
                      <div key={day.id} className="min-w-0">{renderDayCard(day, coverIndex)}</div>
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

export { PreviousDaysSection };
