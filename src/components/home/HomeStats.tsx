"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { format, parseISO, startOfWeek } from "date-fns";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { HOME_STATS_PERIOD_STORAGE_KEY } from "@/components/home/homeHelpers";

/**
 * «Tu progreso» de la home: un solo selector Semana/Mes/Global para los puntos, la posición con
 * medalla y la distribución de intentos. Para invitados, en su lugar, el aviso para entrar y
 * aparecer en el ranking (`HomeGuestCard`).
 *
 * La distribución no tiene API propia: sale de los días ya cargados en la home. Cada partida
 * acertada vale exactamente la base de su intento (no hay bonus de racha), así que de los puntos
 * se deduce el intento (`attemptFromScore`).
 */

const PERIODS = ["week", "month", "global"] as const;
type Period = (typeof PERIODS)[number];

/** Clave de `rankingStats` para cada periodo. */
const RANKING_KEY: Record<Period, "weekly" | "monthly" | "global"> = {
  week: "weekly",
  month: "monthly",
  global: "global",
};

/** Partida terminada, con la fecha del reto y el intento del acierto (`null` = fallada). */
export type CompletedGame = { date: string; attempt: number | null };

function medal(rank: number | null): { icon: string; color: string } {
  if (rank === 1) return { icon: "workspace_premium", color: "text-amber-400" };
  if (rank === 2) return { icon: "workspace_premium", color: "text-zinc-400 dark:text-zinc-300" };
  if (rank === 3) return { icon: "workspace_premium", color: "text-bronze" };
  return { icon: "military_tech", color: "text-muted-foreground" };
}

export function HomeProgress({
  rankingStats,
  completedGames,
  todayDate,
}: {
  rankingStats: Record<"weekly" | "monthly" | "global", { points: number; rank: number | null }>;
  completedGames: CompletedGame[];
  todayDate: string;
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const { formatNumber, numberLocale } = useAppFormatters();
  const tabsId = useId();
  const [period, setPeriod] = useState<Period>("week");

  // Restaurar el último periodo elegido. Ajuste en render y no en un efecto: `mounted` es false
  // en servidor y al hidratar, así que el HTML coincide (ver CLAUDE.md, `set-state-in-effect`).
  const mounted = useIsMounted();
  const [restored, setRestored] = useState(false);
  if (mounted && !restored) {
    setRestored(true);
    try {
      const saved = localStorage.getItem(HOME_STATS_PERIOD_STORAGE_KEY);
      if (saved && (PERIODS as readonly string[]).includes(saved)) setPeriod(saved as Period);
    } catch {
      /* ignore */
    }
  }

  const choose = (next: Period) => {
    setPeriod(next);
    try {
      localStorage.setItem(HOME_STATS_PERIOD_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  // Distribución de intentos del periodo: 1..6 y, al final, falladas.
  const { dist, avg } = useMemo(() => {
    const weekStart = format(startOfWeek(parseISO(todayDate), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const monthKey = todayDate.slice(0, 7);
    const inPeriod = completedGames.filter((g) =>
      period === "week" ? g.date >= weekStart : period === "month" ? g.date.startsWith(monthKey) : true
    );
    const counts = [0, 0, 0, 0, 0, 0, 0];
    let total = 0;
    for (const g of inPeriod) {
      counts[g.attempt ? g.attempt - 1 : 6] += 1;
      // Como `get_user_avg_guesses`: una fallada cuenta como los seis intentos gastados.
      total += g.attempt ?? 6;
    }
    return { dist: counts, avg: inPeriod.length ? total / inPeriod.length : null };
  }, [completedGames, period, todayDate]);

  const stats = rankingStats[RANKING_KEY[period]];
  const m = medal(stats.rank);
  const maxCount = Math.max(1, ...dist);
  const pointsLabel = period === "week" ? t("pointsWeek") : period === "month" ? t("pointsMonth") : t("pointsGlobal");

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <h2 className="font-display text-[21px] font-bold tracking-[-0.025em]">{t("progressTitle")}</h2>
        <div className="inline-flex rounded-[11px] border border-border bg-muted p-[3px]" role="group" aria-label={t("rankingsLabel")}>
          {PERIODS.map((p) => {
            const active = p === period;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => choose(p)}
                className={cn(
                  "relative rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  active ? "text-background" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <motion.span
                    layoutId={`${tabsId}-pill`}
                    aria-hidden
                    className="absolute inset-0 rounded-lg bg-foreground"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <span className="relative">
                  {p === "week" ? t("periodWeek") : p === "month" ? t("periodMonth") : t("periodGlobal")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Puntos + posición */}
      <div className="grid grid-cols-[1fr_auto] items-end gap-2.5 rounded-[22px] border border-border bg-card px-4 pb-3.5 pt-4 shadow-sm">
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{pointsLabel}</p>
          <p className="mt-2 font-display text-[44px] font-extrabold leading-[0.95] tracking-[-0.04em]">
            <AnimatedNumber value={stats.points} format={formatNumber} duration={0.7} />
            <small className="ml-1 font-sans text-sm font-semibold tracking-normal text-muted-foreground">{tc("points")}</small>
          </p>
        </div>
        <div className="flex min-w-[82px] flex-col items-center gap-0.5 rounded-2xl bg-muted px-3 py-2.5">
          <motion.span
            key={m.icon + m.color}
            initial={{ scale: 0.5, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 16 }}
            aria-hidden
            className={cn("material-symbols-outlined text-2xl", m.color)}
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {m.icon}
          </motion.span>
          <b className="font-display text-2xl font-extrabold tracking-[-0.03em] tabular-nums">
            {stats.rank != null ? (
              <>
                #<AnimatedNumber value={stats.rank} format={formatNumber} duration={0.6} />
              </>
            ) : (
              "—"
            )}
          </b>
          <span className="text-[10.5px] font-semibold text-muted-foreground">{t("positionLabel")}</span>
        </div>
        <Link
          href="/ranking"
          className="group col-span-2 flex items-center justify-between border-t border-border pt-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>{t("viewFullRanking")}</span>
          <span aria-hidden className="material-symbols-outlined text-lg text-brand transition-transform group-hover:translate-x-1">
            arrow_forward
          </span>
        </Link>
      </div>

      {/* Distribución de intentos del periodo, a todo el ancho */}
      <div className="mt-2.5 rounded-[22px] border border-border bg-card px-4 pb-3 pt-3.5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t("attemptsDistribution")}
          </p>
          <p className="truncate font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {avg != null
              ? t("avgAttemptsLabel", { avg: avg.toLocaleString(numberLocale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })
              : t("avgAttemptsEmpty")}
          </p>
        </div>
        <div className="mt-3 flex h-14 items-end gap-1.5" aria-hidden>
          {dist.map((count, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={`${period}-${count}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: count > 0 ? 1 : 0, y: 0 }}
                  className="font-mono text-[10px] font-semibold tabular-nums text-muted-foreground"
                >
                  {count}
                </motion.span>
              </AnimatePresence>
              <motion.i
                initial={{ height: "6%" }}
                animate={{ height: `${Math.max(6, (count / maxCount) * 70)}%` }}
                transition={{ delay: 0.05 + i * 0.04, type: "spring", stiffness: 220, damping: 22 }}
                className={cn("w-full rounded-t-md rounded-b-sm opacity-85", i === 6 ? "bg-destructive" : "bg-brand")}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5" aria-hidden>
          {["1", "2", "3", "4", "5", "6", "✕"].map((label) => (
            <span key={label} className="flex-1 text-center font-mono text-[10px] font-medium text-muted-foreground">
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Aviso para invitados: entrar para aparecer en el ranking. */
export function HomeGuestCard() {
  const t = useTranslations("home");
  return (
    // Entrada en CSS: con framer llegaba con `opacity:0` en el HTML del servidor (PERF-04).
    <section className="animate-in fade-in slide-in-from-bottom-3 animation-duration-450 [--tw-ease:cubic-bezier(0.22,1,0.36,1)] [--tw-animation-delay:120ms] fill-mode-backwards">
      <Link
        href="/login"
        className="group relative flex items-center gap-3 overflow-hidden rounded-3xl border border-brand/25 bg-gradient-to-br from-brand/12 via-card to-card px-4 py-4 transition-[border-color,transform] duration-200 hover:border-brand/50 active:scale-[0.98]"
      >
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand/15 ring-1 ring-brand/30 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
          <span aria-hidden className="material-symbols-outlined text-[22px] text-brand" style={{ fontVariationSettings: "'FILL' 1" }}>
            trophy
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("guestBannerTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("guestBannerDescription")}</p>
        </div>
        <span aria-hidden className="material-symbols-outlined text-brand transition-transform duration-300 group-hover:translate-x-1">
          arrow_forward
        </span>
      </Link>
    </section>
  );
}
