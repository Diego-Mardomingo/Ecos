"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useGameProgressStore } from "@/lib/store/gameProgressStore";
import {
  HOME_DAY_STATUS_STALE_MS,
  prefetchGameProgressById,
  prefetchHomeDayStatusById,
  queryKeys,
  type HomeDayStatusData,
  type InProgressProgress,
} from "@/lib/hooks/queries";
import type { PreviousDayGame } from "@/lib/queries/games";
import { cn } from "@/lib/utils";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import type { PlaySkeletonVariant } from "@/lib/navigation/playSkeletonStorage";
import { Link, useRouter } from "@/i18n/navigation";
import { PrefetchPlayOnVisible } from "@/components/home/PrefetchPlayOnVisible";
import { deriveHomeDayState } from "@/components/home/homeDayDerived";
import { titleCaseWords } from "@/components/home/homeHelpers";

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
  const queryClient = useQueryClient();
  const router = useRouter();
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

  // Estado fresco de estos siete días (comparte caché con el calendario del archivo).
  const statusQueries = useQueries({
    queries: days.map((day) => ({
      queryKey: queryKeys.home.dayStatus(day.id),
      queryFn: async (): Promise<HomeDayStatusData> => {
        const res = await fetch(`/api/home/day/${day.id}/status`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch day status");
        return res.json();
      },
      staleTime: HOME_DAY_STATUS_STALE_MS,
      enabled: !!userId,
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
    })),
  });

  const prefetchPlayRoute = useCallback(
    (gameId: string) => {
      router.prefetch(`/play/${gameId}`);
      if (userId) {
        void prefetchGameProgressById(queryClient, gameId).catch(() => undefined);
      }
      void prefetchHomeDayStatusById(queryClient, gameId).catch(() => undefined);
    },
    [queryClient, router, userId]
  );

  if (days.length === 0) return null;

  return (
    <section className="min-w-0">
      <h2 className="mb-1 font-display text-[21px] font-bold tracking-[-0.025em]">{t("recentDays")}</h2>
      {/* Sangra hasta los bordes de la pantalla para que se note que hay más a la derecha. En
          escritorio la columna no llega al borde, así que el corte se difumina. El overflow-x
          también recorta en vertical: el pt-2 deja sitio al ring de la tarjeta y al salto del hover. */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pt-2 pb-2[scrollbar-width:none] min-[670px]:[mask-image:linear-gradient(90deg,transparent,black_1rem,black_calc(100%-2.5rem),transparent)] [&::-webkit-scrollbar]:hidden">
        {days.map((day, i) => {
          const status = userId ? statusQueries[i]?.data : null;
          const d = deriveHomeDayState(day, userId, status ?? null, byGameId);
          return (
            <PrefetchPlayOnVisible key={day.id} gameId={day.id} onPrefetch={prefetchPlayRoute} className="shrink-0 snap-start">
              <motion.div
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.96 }}
              >
                <Link
                  href={`/play/${day.id}`}
                  prefetch={false}
                  onClick={() => onNavigateToGame?.(d.completed ? "completed" : "in_progress")}
                  onMouseEnter={() => prefetchPlayRoute(day.id)}
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
            </PrefetchPlayOnVisible>
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
