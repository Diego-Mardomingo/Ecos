"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { format, parse } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import {
  useLeaderboardHistorySummaries,
  type LeaderboardHistorySummary,
} from "@/lib/hooks/queries";
import { RankingHistoryListContentSkeleton } from "@/components/skeletons";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";

/**
 * Histórico de clasificaciones cerradas: un ganador por semana o por mes.
 *
 * Las semanas van agrupadas por mes en carriles horizontales (un mes = una fila que se desliza),
 * en lugar de los meses plegables de antes: en móvil se ve el mes entero de un vistazo y se pasa
 * de un mes a otro con scroll normal. Los meses van en lista, uno por tarjeta.
 */

type Granularity = "weekly" | "monthly";

type WeekMonthGroup = {
  monthKey: string;
  label: string;
  rows: LeaderboardHistorySummary[];
};

/** `parse` exige fecha de referencia; con un patrón yyyy-MM-dd completo no influye en el resultado. */
const PARSE_REFERENCE = new Date(0);

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface Props {
  initialSummaries?: Partial<Record<"weekly" | "monthly", LeaderboardHistorySummary[]>>;
}

export function LeaderboardHistoryListClient({ initialSummaries }: Props) {
  const t = useTranslations("ranking");
  const [granularity, setGranularity] = useState<Granularity>("weekly");
  const { data: summaries, isLoading } = useLeaderboardHistorySummaries(granularity, initialSummaries);
  const { dateFnsLocale, formatNumber } = useAppFormatters();

  const weeklyGroups = useMemo((): WeekMonthGroup[] => {
    if (!summaries?.length) return [];
    const map = new Map<string, LeaderboardHistorySummary[]>();
    for (const row of summaries) {
      const monthKey = row.period_start.slice(0, 7);
      if (!map.has(monthKey)) map.set(monthKey, []);
      map.get(monthKey)!.push(row);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([monthKey, rows]) => ({
        monthKey,
        label: capitalize(
          format(parse(`${monthKey}-01`, "yyyy-MM-dd", PARSE_REFERENCE), "LLLL yyyy", { locale: dateFnsLocale })
        ),
        rows: rows.sort((a, b) => b.period_start.localeCompare(a.period_start)),
      }));
  }, [summaries, dateFnsLocale]);

  const weekRange = (start: string, end: string) => {
    const a = parse(start, "yyyy-MM-dd", PARSE_REFERENCE);
    const b = parse(end, "yyyy-MM-dd", PARSE_REFERENCE);
    return `${format(a, "d MMM", { locale: dateFnsLocale })} – ${format(b, "d MMM", { locale: dateFnsLocale })}`;
  };

  const monthTitle = (start: string) =>
    capitalize(format(parse(start, "yyyy-MM-dd", PARSE_REFERENCE), "LLLL yyyy", { locale: dateFnsLocale }));

  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col px-4">
      <PageHeader title={t("historyTitle")} backHref="/ranking" backLabel={t("historyBack")} />

      <SegmentedControl
        label={t("periodTabsLabel")}
        options={[
          { value: "weekly", label: t("weekly") },
          { value: "monthly", label: t("monthly") },
        ]}
        value={granularity}
        onChange={setGranularity}
      />

      <div className="flex flex-1 flex-col pb-28 pt-5">
        {isLoading ? (
          <RankingHistoryListContentSkeleton />
        ) : !summaries?.length ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={granularity}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {granularity === "weekly" ? (
                <div className="flex flex-col gap-6">
                  {weeklyGroups.map((group, gi) => (
                    <section key={group.monthKey}>
                      <div className="mb-2.5 flex items-baseline justify-between">
                        <h2 className="text-base font-semibold">{group.label}</h2>
                        <span className="text-xs text-muted-foreground">
                          {t("historyWeekCount", { count: group.rows.length })}
                        </span>
                      </div>
                      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {group.rows.map((row, i) => (
                          <WinnerCard
                            key={row.period_start}
                            href={`/ranking/history/weekly/${row.period_start}`}
                            title={weekRange(row.period_start, row.period_end)}
                            row={row}
                            delay={Math.min(gi * 2 + i, 10) * 0.04}
                            className="w-[220px] shrink-0 snap-start"
                            formatPoints={formatNumber}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {summaries.map((row, i) => (
                    <WinnerCard
                      key={row.period_start}
                      href={`/ranking/history/monthly/${row.period_start}`}
                      title={monthTitle(row.period_start)}
                      row={row}
                      delay={Math.min(i, 10) * 0.04}
                      formatPoints={formatNumber}
                      large
                    />
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/** Tarjeta de un periodo cerrado con su ganador. */
function WinnerCard({
  href,
  title,
  row,
  delay,
  formatPoints,
  large = false,
  className,
}: {
  href: string;
  title: string;
  row: LeaderboardHistorySummary;
  delay: number;
  formatPoints: (n: number) => string;
  large?: boolean;
  className?: string;
}) {
  const t = useTranslations("ranking");
  const name = row.winner_display_name ?? t("playerFallback");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.97 }}
      className={className}
    >
      <Link
        href={href}
        className="group relative block overflow-hidden rounded-3xl border border-border bg-card p-4 transition-colors hover:border-brand/40"
      >
        <div aria-hidden className="absolute -right-8 -top-8 size-24 rounded-full bg-amber-400/15 blur-2xl transition-opacity group-hover:opacity-100" />
        <div className="relative flex items-center justify-between gap-2">
          <p className={cn("truncate font-semibold", large ? "text-base" : "text-sm")}>{title}</p>
          <span aria-hidden className="material-symbols-outlined text-lg text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5">
            chevron_right
          </span>
        </div>
        {row.winner_user_id ? (
          <div className="relative mt-3 flex items-center gap-3">
            <div className="relative shrink-0">
              <span aria-hidden className="absolute -top-3 left-1/2 -translate-x-1/2 text-sm">
                👑
              </span>
              <Avatar className="size-11 ring-2 ring-amber-400 ring-offset-2 ring-offset-card">
                <AvatarImage src={row.winner_avatar_url ?? undefined} />
                <AvatarFallback className="bg-muted text-xs font-bold">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-xs font-bold tabular-nums text-amber-500 dark:text-amber-400">
                {row.winner_points != null ? formatPoints(row.winner_points) : "—"}{" "}
                <span className="font-medium text-muted-foreground">{t("totalPointsShort")}</span>
              </p>
            </div>
          </div>
        ) : (
          <p className="relative mt-3 text-sm text-muted-foreground">{t("historyNoDataPeriod")}</p>
        )}
      </Link>
    </motion.div>
  );
}
