"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { useGameProgressStore } from "@/lib/store/gameProgressStore";
import type { InProgressProgress } from "@/lib/hooks/queries";
import type { PreviousDayGame } from "@/lib/queries/games";
import { cn } from "@/lib/utils";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import type { PlaySkeletonVariant } from "@/lib/navigation/playSkeletonStorage";
import { Link } from "@/i18n/navigation";
import { deriveHomeDayFromHistory } from "@/components/home/homeDayDerived";
import { titleCaseWords } from "@/components/home/homeHelpers";
import { usePrefetchPlayRoute } from "@/components/home/usePrefetchPlayRoute";

/**
 * «Últimos días»: carril horizontal con los siete retos anteriores, que es lo que casi siempre se
 * busca al volver a la home (el de ayer, el que quedó a medias). Los jugados enseñan su carátula;
 * los que no, un vinilo con la galleta de un color distinto por reto.
 */

const RECENT_DAYS_COUNT = 7;

export function HomeRecentDays({
  previousDays,
  todayDate,
  userId,
  inProgressByGameId = {},
  onNavigateToGame,
}: {
  previousDays: PreviousDayGame[];
  todayDate: string;
  userId: string | null;
  inProgressByGameId?: Record<string, InProgressProgress>;
  onNavigateToGame?: (variant: PlaySkeletonVariant) => void;
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const { dateFnsLocale, formatNumber } = useAppFormatters();
  const byGameId = useGameProgressStore((s) => s.byGameId);

  const days = useMemo(
    () =>
      [...previousDays]
        .filter((d) => d.date < todayDate)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, RECENT_DAYS_COUNT),
    [previousDays, todayDate]
  );

  const prefetchPlayRoute = usePrefetchPlayRoute(userId);

  if (days.length === 0) return null;

  return (
    <section className="min-w-0">
      <h2 className="mb-1 font-display text-[21px] font-bold tracking-[-0.025em]">{t("recentDays")}</h2>
      {/* Sangra hasta los bordes de la pantalla para que se note que hay más a la derecha. En
          escritorio la columna no llega al borde, así que el corte se difumina. El overflow-x
          también recorta en vertical: el pt-2 deja sitio al ring de la tarjeta y al salto del hover. */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pt-2 pb-2[scrollbar-width:none] min-[670px]:[mask-image:linear-gradient(90deg,transparent,black_1rem,black_calc(100%-2.5rem),transparent)] [&::-webkit-scrollbar]:hidden">
        {days.map((day, i) => {
          const d = deriveHomeDayFromHistory(day, userId, inProgressByGameId[day.id], byGameId);
          return (
            // Entrada en CSS (no oculta la tarjeta en el HTML del servidor, PERF-04); el hover y el
            // toque siguen en framer, en el nodo de dentro.
            <div
              key={day.id}
              className="shrink-0 snap-start animate-in fade-in slide-in-from-right-6 animation-duration-450 [--tw-ease:cubic-bezier(0.22,1,0.36,1)] fill-mode-backwards"
              style={{ animationDelay: `${150 + i * 50}ms` }}
            >
              <motion.div
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.96 }}
                // framer hace enfocable (tabindex=0) lo que lleva `whileTap`: sin esto, cada
                // tarjeta eran dos paradas de tabulación, este div sin nombre y el enlace (UX-13).
                tabIndex={-1}
              >
                <Link
                  href={`/play/${day.id}`}
                  prefetch={false}
                  onClick={() => onNavigateToGame?.(d.completed ? "completed" : "in_progress")}
                  onPointerEnter={() => prefetchPlayRoute(day.id)}
                  onTouchStart={() => prefetchPlayRoute(day.id)}
                  onFocus={() => prefetchPlayRoute(day.id)}
                  className="group block w-[124px] rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="relative aspect-square overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                    {d.completed && d.displayCover ? (
                      <>
                        <Image
                          src={d.displayCover}
                          alt={d.displayTitle || ""}
                          fill
                          sizes="124px"
                          className={cn(
                            "object-cover transition-transform duration-500 group-hover:scale-105",
                            !d.won && "grayscale-[60%]"
                          )}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                        <span
                          className={cn(
                            "absolute right-2 top-2 flex size-6 items-center justify-center rounded-full shadow-md",
                            d.won ? "bg-brand text-primary-foreground" : "bg-destructive text-white"
                          )}
                        >
                          <span aria-hidden className="material-symbols-outlined text-base font-bold">
                            {d.won ? "check" : "close"}
                          </span>
                        </span>
                      </>
                    ) : (
                      <MiniVinyl gameNumber={day.game_number} spinning={d.inProgress} />
                    )}
                    <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-white backdrop-blur">
                      #{day.game_number}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-xs font-semibold">
                    {titleCaseWords(format(parseISO(day.date), "EEE d MMM", { locale: dateFnsLocale }))}
                  </p>
                  {d.completed && d.displayScore !== null ? (
                    <p className={cn("text-xs font-medium tabular-nums", d.displayScore === 0 ? "text-destructive" : "text-brand")}>
                      {formatNumber(d.displayScore)} {tc("points")}
                    </p>
                  ) : d.inProgress ? (
                    <div className="mt-1.5 flex gap-0.5" aria-label={t("legendInProgress")}>
                      {Array.from({ length: d.maxAttempts }).map((_, j) => (
                        <span key={j} className={cn("h-1 flex-1 rounded-full", j < d.guesses.length ? "bg-amber-500" : "bg-muted")} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("notPlayedYet")}</p>
                  )}
                </Link>
              </motion.div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Vinilo en miniatura para los días sin jugar: el disco aún está "por escuchar". El color de la
 * galleta central varía con el número de reto para que el carril no sea una fila de clones.
 */
function MiniVinyl({ gameNumber, spinning }: { gameNumber: number; spinning: boolean }) {
  const hue = (gameNumber * 47) % 360;
  return (
    <div className="flex size-full items-center justify-center bg-gradient-to-br from-muted to-card">
      <div
        className={cn(
          "ecos-vinyl relative size-[78%] rounded-full shadow-[0_8px_20px_-6px_rgba(0,0,0,0.6)] transition-transform duration-700 group-hover:rotate-[200deg]",
          spinning && "ecos-spin-slow"
        )}
      >
        <div
          className="absolute inset-[34%] rounded-full"
          style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 40%))` }}
        />
        <div className="absolute inset-[47%] rounded-full bg-black/80" />
      </div>
    </div>
  );
}
