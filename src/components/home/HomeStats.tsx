"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { HOME_STATS_PERIOD_STORAGE_KEY } from "@/components/home/homeHelpers";

/**
 * Carrusel de estadísticas de la home (global / semanal / mensual) y la tarjeta que pinta cada
 * métrica. Extraído de `HomeClient` sin cambios de lógica.
 */
function HomeStatsCarousel({
  rankingStats,
  t,
  tc,
}: {
  rankingStats: { global: { points: number; rank: number | null }; weekly: { points: number; rank: number | null }; monthly: { points: number; rank: number | null } };
  t: (key: string) => string;
  tc: (key: string) => string;
}) {
  const { formatNumber } = useAppFormatters();
  const [api, setApi] = useState<CarouselApi>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const periods = ["global", "weekly", "monthly"] as const;

  // Restaurar último período guardado y persistir al cambiar
  useEffect(() => {
    if (!api) return;

    const onSelect = () => {
      const i = api.selectedScrollSnap();
      setSelectedIndex(i);
      try {
        localStorage.setItem(HOME_STATS_PERIOD_STORAGE_KEY, periods[i]);
      } catch {
        /* ignore */
      }
    };
    // Suscribir antes de mover el carrusel, para no perder el evento que emite scrollTo.
    api.on("select", onSelect);

    const saved = localStorage.getItem(HOME_STATS_PERIOD_STORAGE_KEY);
    const idx = saved != null ? periods.indexOf(saved as (typeof periods)[number]) : -1;
    const initialIndex = idx >= 0 ? idx : 0;
    if (initialIndex !== 0) api.scrollTo(initialIndex, true);

    // Sincronizar con la posición real en el siguiente frame: cubre el caso de que
    // scrollTo no llegue a emitir "select", sin hacer setState en el cuerpo del efecto.
    const raf = requestAnimationFrame(onSelect);
    return () => {
      cancelAnimationFrame(raf);
      api.off("select", onSelect);
    };
    // `periods` es una constante literal, no cambia entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                    value={formatNumber(rankingStats[period].points)}
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
          <span aria-hidden
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

export { HomeStatsCarousel };
