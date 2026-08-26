"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format, parse, startOfMonth } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  useLeaderboardHistorySummaries,
  type LeaderboardHistorySummary,
} from "@/lib/hooks/queries";
import { RankingHistoryListContentSkeleton } from "@/components/skeletons";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";

type Granularity = "weekly" | "monthly";

type WeekMonthGroup = {
  monthKey: string;
  label: string;
  rows: LeaderboardHistorySummary[];
};

interface Props {
  initialSummaries?: Partial<
    Record<"weekly" | "monthly", LeaderboardHistorySummary[]>
  >;
}

export function LeaderboardHistoryListClient({
  initialSummaries,
}: Props) {
  const t = useTranslations("ranking");
  const locale = useLocale();
  const [granularity, setGranularity] = useState<Granularity>("weekly");
  const { data: summaries, isLoading } = useLeaderboardHistorySummaries(
    granularity,
    initialSummaries
  );

  const dfLocale = locale === "es" ? esLocale : enUS;

  const currentMonthKey = format(startOfMonth(new Date()), "yyyy-MM");

  const weeklyGroups = useMemo((): WeekMonthGroup[] => {
    if (!summaries?.length) return [];
    const map = new Map<string, LeaderboardHistorySummary[]>();
    for (const row of summaries) {
      const d = parse(row.period_start, "yyyy-MM-dd", new Date());
      const monthKey = format(d, "yyyy-MM");
      if (!map.has(monthKey)) map.set(monthKey, []);
      map.get(monthKey)!.push(row);
    }
    const entries = Array.from(map.entries()).sort((a, b) =>
      b[0].localeCompare(a[0])
    );
    return entries.map(([monthKey, rows]) => ({
      monthKey,
      label: format(
        parse(`${monthKey}-01`, "yyyy-MM-dd", new Date()),
        "LLLL yyyy",
        { locale: dfLocale }
      ),
      rows: rows.sort((a, b) => b.period_start.localeCompare(a.period_start)),
    }));
  }, [summaries, dfLocale]);

  const defaultOpenMonthKey = useMemo(() => {
    if (!weeklyGroups.length) return null;
    if (weeklyGroups.some((g) => g.monthKey === currentMonthKey)) {
      return currentMonthKey;
    }
    return weeklyGroups[0].monthKey;
  }, [weeklyGroups, currentMonthKey]);

  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});

  // Reset al cambiar de granularidad, ajustando el estado durante el render
  // (patrón recomendado por React) en lugar de sincronizarlo con un efecto.
  const [lastGranularity, setLastGranularity] = useState(granularity);
  if (granularity !== lastGranularity) {
    setLastGranularity(granularity);
    setOpenMonths({});
  }

  const isMonthOpen = (monthKey: string) => {
    if (openMonths[monthKey] !== undefined) return openMonths[monthKey];
    return monthKey === defaultOpenMonthKey;
  };

  const { formatNumber: formatPoints } = useAppFormatters();

  const formatRange = (start: string, end: string) => {
    const a = parse(start, "yyyy-MM-dd", new Date());
    const b = parse(end, "yyyy-MM-dd", new Date());
    if (granularity === "weekly") {
      return `${format(a, "d MMM", { locale: dfLocale })} – ${format(b, "d MMM yyyy", { locale: dfLocale })}`;
    }
    return format(a, "LLLL yyyy", { locale: dfLocale });
  };

  const periodTitle = (start: string, end: string) => {
    const a = parse(start, "yyyy-MM-dd", new Date());
    if (granularity === "weekly") {
      return t("historyWeekHeading", {
        date: format(a, "d MMM yyyy", { locale: dfLocale }),
      });
    }
    return format(a, "LLLL yyyy", { locale: dfLocale });
  };

  const renderSummaryCard = (row: LeaderboardHistorySummary, motionIndex: number) => (
    <motion.div
      key={`${row.period_start}-${row.period_end}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: motionIndex * 0.03 }}
    >
      <Link
        href={`/ranking/history/${granularity}/${row.period_start}`}
        className="block rounded-2xl border border-border/60 bg-card p-4 transition-colors hover:bg-muted/40"
      >
        {granularity === "weekly" ? (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {periodTitle(row.period_start, row.period_end)}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {formatRange(row.period_start, row.period_end)}
            </p>
          </>
        ) : (
          <p className="text-sm font-medium capitalize text-muted-foreground">
            {periodTitle(row.period_start, row.period_end)}
          </p>
        )}
        <div className="mt-4 flex items-center gap-3">
          {row.winner_user_id ? (
            <>
              <Avatar className="h-12 w-12 shrink-0 ring-2 ring-brand/40">
                <AvatarImage src={row.winner_avatar_url ?? undefined} />
                <AvatarFallback className="bg-secondary text-sm font-bold">
                  {(row.winner_display_name ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {row.winner_display_name ?? t("playerFallback")}
                </p>
                <p className="text-xs font-bold text-brand">
                  {row.winner_points != null ? formatPoints(row.winner_points) : "—"}{" "}
                  <span className="font-medium text-muted-foreground">
                    {t("totalPointsShort")}
                  </span>
                </p>
              </div>
              <span
                className="material-symbols-outlined text-muted-foreground"
                aria-hidden
              >
                chevron_right
              </span>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("historyNoDataPeriod")}</p>
          )}
        </div>
      </Link>
    </motion.div>
  );

  return (
    <div className="flex min-h-full flex-col min-h-[calc(100dvh-5rem)]">
      <header
        className="sticky top-0 z-30 flex items-center gap-2 px-2 py-3 pt-safe backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--background) 85%, transparent)" }}
      >
        <Link
          href="/ranking"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-brand transition-opacity hover:opacity-80"
          aria-label={t("historyBack")}
        >
          <span aria-hidden className="material-symbols-outlined text-2xl">arrow_back</span>
        </Link>
        <h1 className="min-w-0 flex-1 text-center text-base font-bold pr-9">
          {t("historyTitle")}
        </h1>
      </header>

      <div className="px-4 pb-3">
        <div className="relative flex rounded-full bg-muted p-1">
          <motion.div
            layout
            className="absolute inset-y-1 rounded-full bg-brand"
            style={{
              width: "calc(50% - 4px)",
              left: granularity === "weekly" ? "4px" : "calc(50% + 2px)",
            }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
          />
          <button
            type="button"
            onClick={() => setGranularity("weekly")}
            className={cn(
              "relative z-10 flex-1 rounded-full py-2 text-sm font-semibold transition-colors",
              granularity === "weekly" ? "text-primary-foreground" : "text-muted-foreground"
            )}
          >
            {t("weekly")}
          </button>
          <button
            type="button"
            onClick={() => setGranularity("monthly")}
            className={cn(
              "relative z-10 flex-1 rounded-full py-2 text-sm font-semibold transition-colors",
              granularity === "monthly" ? "text-primary-foreground" : "text-muted-foreground"
            )}
          >
            {t("monthly")}
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 pb-28">
        {isLoading ? (
          <RankingHistoryListContentSkeleton />
        ) : !summaries?.length ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {t("historyEmpty")}
          </p>
        ) : granularity === "monthly" ? (
          <div className="flex flex-col gap-3">
            {summaries.map((row, i) => renderSummaryCard(row, i))}
          </div>
        ) : (
          <div className="space-y-2">
            {weeklyGroups.map((g) => {
              const isOpen = isMonthOpen(g.monthKey);
              return (
                <Collapsible
                  key={g.monthKey}
                  open={isOpen}
                  onOpenChange={(v) =>
                    setOpenMonths((cur) => ({ ...cur, [g.monthKey]: Boolean(v) }))
                  }
                >
                  <Card className="gap-0 py-0">
                    <CardContent className="px-3 py-3">
                      <CollapsibleTrigger className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md py-1 text-left hover:bg-muted/30">
                        <span className="truncate font-medium capitalize">
                          {g.label}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="secondary">
                            {t("historyWeekCount", { count: g.rows.length })}
                          </Badge>
                          <span
                            className="material-symbols-outlined text-base text-muted-foreground"
                            style={{ fontVariationSettings: "'FILL' 0" }}
                            aria-hidden
                          >
                            {isOpen ? "expand_less" : "expand_more"}
                          </span>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-3 space-y-3">
                          {g.rows.map((row, i) =>
                            renderSummaryCard(row, i)
                          )}
                        </div>
                      </CollapsibleContent>
                    </CardContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
