"use client";

import { useState, useCallback, useRef, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, m } from "framer-motion";
import { Link } from "@/i18n/navigation";
import {
  fetchLeaderboardPeriodData,
  queryKeys,
  RANKING_STALE_MS,
  useLeaderboard,
} from "@/lib/hooks/queries";
import { useLeaderboardRealtime } from "@/lib/realtime/useLeaderboardRealtime";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import {
  LeaderboardPodiumAndList,
  leaderboardRowId,
} from "@/components/leaderboard/LeaderboardPodiumAndList";
import { rankingDisplayName } from "@/lib/display-name";
import { useLoginHref } from "@/components/game/useLoginHref";
import type { LeaderboardEntryRow as LeaderboardEntry } from "@/lib/queries/users";
import { HeaderIconLink, PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
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
}

type PeriodTab = "weekly" | "monthly" | "global";

const PERIOD_ORDER: PeriodTab[] = ["weekly", "monthly", "global"];

export function LeaderboardClient({ initialByPeriod }: Props) {
  const t = useTranslations("ranking");
  const loginHref = useLoginHref();
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

  const { data, isLoading } = useLeaderboard(activeTab, initialByPeriod);
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
  const tabsBaseId = useId();
  const tabId = (tab: PeriodTab) => `${tabsBaseId}-tab-${tab}`;
  const panelId = `${tabsBaseId}-panel`;
  /** Sentido del último cambio de periodo, para que el panel entre por el lado correcto. */
  const [direction, setDirection] = useState<1 | -1>(1);

  const changeTab = useCallback(
    (next: PeriodTab) => {
      setDirection(PERIOD_ORDER.indexOf(next) >= PERIOD_ORDER.indexOf(activeTab) ? 1 : -1);
      setActiveTab(next);
    },
    [activeTab]
  );

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const delta = e.changedTouches[0].clientX - touchStartX.current;
      const idx = PERIOD_ORDER.indexOf(activeTab);
      const len = PERIOD_ORDER.length;
      if (delta > SWIPE_THRESHOLD) {
        changeTab(PERIOD_ORDER[(idx - 1 + len) % len]);
      } else if (delta < -SWIPE_THRESHOLD) {
        changeTab(PERIOD_ORDER[(idx + 1) % len]);
      }
    },
    [activeTab, changeTab]
  );

  const { formatNumber: formatPoints } = useAppFormatters();

  const getDisplayName = (entry: LeaderboardEntry) =>
    rankingDisplayName(entry.profiles?.display_name, t("playerFallback"));

  const showListSkeleton = entries.length === 0 && isLoading;
  const myEntry = currentUserId ? entries.find((e) => e.user_id === currentUserId) : undefined;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col px-4">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        action={<HeaderIconLink href="/ranking/history" icon="history" label={t("historyLinkAria")} />}
      />

      {!currentUserId && (
        // Entrada en CSS: con framer llegaba con `opacity:0` en el HTML del servidor (PERF-04).
        <div className="mb-3 flex animate-in items-center gap-3 rounded-3xl border border-brand/25 bg-gradient-to-br from-brand/12 via-card to-card px-4 py-3 fade-in slide-in-from-bottom-2 animation-duration-300 [--tw-ease:cubic-bezier(0.22,1,0.36,1)]">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-brand">
            <span aria-hidden className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
              emoji_events
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t("guestBannerTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("guestBannerDescription")}</p>
          </div>
          <Link
            href={loginHref}
            className="shrink-0 rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-primary-foreground transition-transform active:scale-95"
          >
            {t("guestBannerCta")}
          </Link>
        </div>
      )}

      <SegmentedControl
        asTabs
        label={t("periodTabsLabel")}
        options={PERIOD_ORDER.map((tab) => ({ value: tab, label: t(tab) }))}
        value={activeTab}
        onChange={changeTab}
        tabIdFor={tabId}
        panelId={panelId}
      />

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(activeTab)}
        className="flex min-h-0 flex-1 flex-col"
        style={{ touchAction: "pan-y" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <m.div
            key={activeTab}
            custom={direction}
            initial={{ opacity: 0, x: direction * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -24 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-h-0 flex-col"
          >
            {myEntry && (
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById(leaderboardRowId(myEntry.user_id))
                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
                className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-brand/30 bg-brand/10 px-3.5 py-2.5 text-left transition-transform active:scale-[0.98]"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-black tabular-nums text-primary-foreground">
                  {myEntry.global_rank}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-muted-foreground">{t("yourPosition")}</span>
                  <span className="block truncate text-sm font-bold">
                    {formatPoints(myEntry.total_points)} {t("totalPointsShort")}
                    <span className="px-1.5 font-normal text-muted-foreground">·</span>
                    <span className="font-medium text-muted-foreground">
                      {t("hitsPodiumLine", { count: myEntry.aciertos })}
                    </span>
                  </span>
                </span>
                {myEntry.global_rank > 3 && (
                  <span aria-hidden className="material-symbols-outlined text-lg text-brand">
                    south
                  </span>
                )}
              </button>
            )}

            {showListSkeleton ? (
              <RankingPodiumAndListSkeleton />
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <span className="mb-4 flex size-16 animate-in items-center justify-center rounded-full bg-muted fade-in zoom-in-60 animation-duration-400 [--tw-ease:cubic-bezier(0.34,1.56,0.64,1)]">
                  <span
                    aria-hidden
                    className="material-symbols-outlined text-3xl text-muted-foreground"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    emoji_events
                  </span>
                </span>
                <p className="text-sm font-medium text-muted-foreground">{t("emptyPeriod")}</p>
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
          </m.div>
        </AnimatePresence>
        {/* Relleno táctil: con pocas filas, el hueco bajo la lista debe seguir disparando el swipe */}
        <div className="min-h-0 w-full flex-1" aria-hidden />
      </div>
    </div>
  );
}
