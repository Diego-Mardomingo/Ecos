"use client";

import { useState, useCallback, useRef, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import {
  fetchLeaderboardPeriodData,
  queryKeys,
  RANKING_STALE_MS,
  useLeaderboard,
} from "@/lib/hooks/queries";
import { useLeaderboardRealtime } from "@/lib/realtime/useLeaderboardRealtime";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { cn } from "@/lib/utils";
import {
  LeaderboardPodiumAndList,
  type LeaderboardEntry,
} from "@/components/leaderboard/LeaderboardPodiumAndList";
import { RankingPodiumAndListSkeleton } from "@/components/skeletons";
import type { RankingData } from "@/lib/hooks/queries";
import { useQueryClient } from "@tanstack/react-query";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";

const SWIPE_THRESHOLD = 50;
const RANKING_PERIOD_STORAGE_KEY = "ecos-ranking-period";

interface Props {
  initialByPeriod?: Partial<
    Record<"weekly" | "monthly" | "global", RankingData>
  >;
  /** @deprecated usar initialByPeriod */
  initialData?: RankingData;
}

type PeriodTab = "weekly" | "monthly" | "global";

const PERIOD_ORDER: PeriodTab[] = ["weekly", "monthly", "global"];

export function LeaderboardClient({ initialByPeriod, initialData }: Props) {
  const t = useTranslations("ranking");
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PeriodTab>("global");

  // Restauración del último periodo ajustando el estado durante el render:
  // `mounted` es false en servidor y al hidratar, así que el HTML coincide, y el
  // valor guardado se aplica antes del primer pintado en cliente.
  const mounted = useIsMounted();
  const [hasRestoredTab, setHasRestoredTab] = useState(false);
  if (mounted && !hasRestoredTab) {
    setHasRestoredTab(true);
    const saved = localStorage.getItem(RANKING_PERIOD_STORAGE_KEY);
    const idx = saved != null ? PERIOD_ORDER.indexOf(saved as PeriodTab) : -1;
    if (idx >= 0) setActiveTab(PERIOD_ORDER[idx]);
  }

  useEffect(() => {
    // Persistir solo después de restaurar, para no pisar el valor guardado con el inicial.
    if (!hasRestoredTab) return;
    localStorage.setItem(RANKING_PERIOD_STORAGE_KEY, activeTab);
  }, [hasRestoredTab, activeTab]);

  useEffect(() => {
    if (!initialByPeriod) return;
    for (const period of PERIOD_ORDER) {
      const payload = initialByPeriod[period];
      if (!payload) continue;
      const key = queryKeys.ranking.period(period);
      if (queryClient.getQueryData(key) !== undefined) continue;
      queryClient.setQueryData(key, payload);
    }
  }, [initialByPeriod, queryClient]);

  useEffect(() => {
    for (const period of PERIOD_ORDER) {
      if (period === activeTab) continue;
      void queryClient.prefetchQuery({
        queryKey: queryKeys.ranking.period(period),
        queryFn: () => fetchLeaderboardPeriodData(period),
        staleTime: RANKING_STALE_MS,
      });
    }
  }, [activeTab, queryClient]);

  const { data, isLoading } = useLeaderboard(
    activeTab,
    initialByPeriod,
    initialData
  );
  useLeaderboardRealtime();
  const entries = data?.entries ?? [];

  // Conserva el último usuario conocido para que el banner de invitado no
  // parpadee mientras `data` está indefinido al cambiar de periodo. Se guarda en
  // estado ajustado durante el render, no en una ref: leer y escribir refs en
  // render rompe las garantías del compilador de React.
  const [lastUserId, setLastUserId] = useState<string | null>(null);
  if (data?.currentUserId !== undefined && data.currentUserId !== lastUserId) {
    setLastUserId(data.currentUserId);
  }
  const currentUserId = data?.currentUserId ?? lastUserId;

  const touchStartX = useRef<number>(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabsBaseId = useId();
  const tabId = (tab: PeriodTab) => `${tabsBaseId}-tab-${tab}`;
  const panelId = `${tabsBaseId}-panel`;

  /** Cambia de periodo por indice, con ciclo. Compartido por el swipe y las flechas. */
  const selectTabAt = useCallback((index: number, moveFocus: boolean) => {
    const len = PERIOD_ORDER.length;
    const nextIndex = (index + len) % len;
    setActiveTab(PERIOD_ORDER[nextIndex]);
    // Con roving tabindex el destino tiene tabIndex -1 hasta el siguiente render, pero
    // focus() programatico funciona igual: -1 solo lo saca de la tabulacion.
    if (moveFocus) tabRefs.current[nextIndex]?.focus();
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const delta = e.changedTouches[0].clientX - touchStartX.current;
      const idx = PERIOD_ORDER.indexOf(activeTab);
      if (delta > SWIPE_THRESHOLD) {
        selectTabAt(idx - 1, false);
      } else if (delta < -SWIPE_THRESHOLD) {
        selectTabAt(idx + 1, false);
      }
    },
    [activeTab, selectTabAt]
  );

  /**
   * Equivalente de teclado del swipe, que no tenia ninguno. Activacion automatica (la flecha
   * cambia de periodo, no solo de foco) porque los tres periodos vienen prefetcheados.
   */
  const handleTabsKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const idx = PERIOD_ORDER.indexOf(activeTab);
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          selectTabAt(idx + 1, true);
          return;
        case "ArrowLeft":
          event.preventDefault();
          selectTabAt(idx - 1, true);
          return;
        case "Home":
          event.preventDefault();
          selectTabAt(0, true);
          return;
        case "End":
          event.preventDefault();
          selectTabAt(PERIOD_ORDER.length - 1, true);
          return;
        default:
          return;
      }
    },
    [activeTab, selectTabAt]
  );

  const { formatNumber: formatPoints } = useAppFormatters();

  const getDisplayName = (entry: LeaderboardEntry) => {
    const name = entry.profiles?.display_name?.trim();
    if (name && name.toLowerCase() !== "admin") return name;
    return t("playerFallback");
  };

  const indicatorLeft =
    activeTab === "weekly"
      ? "4px"
      : activeTab === "monthly"
        ? "calc(33.333% + 2px)"
        : "calc(66.666% + 2px)";

  const showListSkeleton = entries.length === 0 && isLoading;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 px-4 pb-3 backdrop-blur-md"
        style={{
          background: "color-mix(in srgb, var(--background) 85%, transparent)",
          paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))",
        }}
      >
        <div className="flex-1" />
        <h1 className="text-base font-bold">{t("title")}</h1>
        <div className="flex flex-1 justify-end">
          <Link
            href="/ranking/history"
            className="inline-flex h-9 w-auto shrink-0 items-center justify-start gap-1.5 rounded-xl border border-border bg-muted px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground max-w-[min(100%,11rem)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("historyLinkAria")}
          >
            <span aria-hidden
              className="material-symbols-outlined shrink-0 text-xl text-brand/70"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              history
            </span>
            <span className="truncate">{t("historyButtonLabel")}</span>
          </Link>
        </div>
      </header>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(activeTab)}
        className="flex min-h-0 flex-1 flex-col touch-pan-y"
        style={{ touchAction: "pan-y" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {!currentUserId && (
          <div className="mx-4 mt-1 flex items-center gap-3 rounded-2xl bg-brand/10 px-4 py-3">
            <span aria-hidden
              className="material-symbols-outlined text-xl text-brand"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              emoji_events
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("guestBannerTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("guestBannerDescription")}
              </p>
            </div>
            <Link
              href="/login?redirect=/ranking"
              className="flex-shrink-0 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-primary-foreground"
            >
              {t("guestBannerCta")}
            </Link>
          </div>
        )}

        <div className="px-4 py-3">
          <div
            role="tablist"
            aria-label={t("periodTabsLabel")}
            onKeyDown={handleTabsKeyDown}
            className="relative flex rounded-full bg-muted p-1"
          >
            <motion.div
              aria-hidden
              layout
              className="absolute inset-y-1 rounded-full bg-brand"
              style={{
                width: "calc(33.333% - 5px)",
                left: indicatorLeft,
              }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
            />
            {PERIOD_ORDER.map((tab, index) => (
              <button
                key={tab}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                type="button"
                role="tab"
                id={tabId(tab)}
                aria-selected={activeTab === tab}
                aria-controls={panelId}
                /** Roving tabindex: solo la pestana activa entra en la tabulacion. */
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "relative z-10 flex-1 rounded-full py-2 text-sm font-semibold transition-colors",
                  activeTab === tab ? "text-primary-foreground" : "text-muted-foreground"
                )}
              >
                {t(tab)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {showListSkeleton ? (
            <RankingPodiumAndListSkeleton />
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <span aria-hidden
                className="material-symbols-outlined mb-4 text-4xl text-muted-foreground"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                emoji_events
              </span>
              <p className="text-sm font-medium text-muted-foreground">
                {t("emptyPeriod")}
              </p>
            </div>
          ) : (
            <LeaderboardPodiumAndList
              entries={entries}
              currentUserId={currentUserId}
              formatPoints={formatPoints}
              getDisplayName={getDisplayName}
              t={t}
            />
          )}
          {/* Relleno táctil: con pocas filas, el hueco bajo la lista debe seguir disparando el swipe */}
          <div className="min-h-0 w-full flex-1" aria-hidden />
        </div>
      </div>
    </div>
  );
}
