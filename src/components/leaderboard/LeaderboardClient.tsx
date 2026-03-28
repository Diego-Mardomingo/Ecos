"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { useLeaderboard } from "@/lib/hooks/queries";
import { useLeaderboardRealtime } from "@/lib/realtime/useLeaderboardRealtime";
import { cn } from "@/lib/utils";
import {
  LeaderboardPodiumAndList,
  type LeaderboardEntry,
} from "@/components/leaderboard/LeaderboardPodiumAndList";

const SWIPE_THRESHOLD = 50;
const RANKING_PERIOD_STORAGE_KEY = "ecos-ranking-period";

interface Props {
  initialData?: {
    entries: LeaderboardEntry[];
    currentUserId: string | null;
  };
}

type PeriodTab = "weekly" | "monthly" | "global";

const PERIOD_ORDER: PeriodTab[] = ["weekly", "monthly", "global"];

export function LeaderboardClient({ initialData }: Props) {
  const t = useTranslations("ranking");
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<PeriodTab>("global");

  const isFirstSaveRun = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(RANKING_PERIOD_STORAGE_KEY);
    const idx = saved != null ? PERIOD_ORDER.indexOf(saved as PeriodTab) : -1;
    if (idx >= 0) setActiveTab(PERIOD_ORDER[idx]);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isFirstSaveRun.current) {
      isFirstSaveRun.current = false;
      return;
    }
    localStorage.setItem(RANKING_PERIOD_STORAGE_KEY, activeTab);
  }, [activeTab]);

  const { data, isLoading } = useLeaderboard(activeTab, initialData);
  useLeaderboardRealtime();
  const entries = data?.entries ?? [];

  const lastUserIdRef = useRef<string | null>(null);
  if (data?.currentUserId !== undefined) {
    lastUserIdRef.current = data.currentUserId;
  }
  const currentUserId = data?.currentUserId ?? lastUserIdRef.current;

  const touchStartX = useRef<number>(0);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const delta = e.changedTouches[0].clientX - touchStartX.current;
      const idx = PERIOD_ORDER.indexOf(activeTab);
      if (delta > SWIPE_THRESHOLD) {
        setActiveTab(PERIOD_ORDER[(idx - 1 + 3) % 3]);
      } else if (delta < -SWIPE_THRESHOLD) {
        setActiveTab(PERIOD_ORDER[(idx + 1) % 3]);
      }
    },
    [activeTab]
  );

  const formatPoints = useCallback(
    (n: number) => n.toLocaleString(locale === "es" ? "es-ES" : "en-US"),
    [locale]
  );

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

  return (
    <div className="flex min-h-full flex-col min-h-[calc(100dvh-5rem)]">
      <header
        className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 pt-safe backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--background) 85%, transparent)" }}
      >
        <div className="flex h-9 w-9" aria-hidden />
        <h1 className="text-base font-bold">{t("title")}</h1>
        <Link
          href="/ranking/history"
          className="flex h-9 w-9 items-center justify-center rounded-full text-brand transition-opacity hover:opacity-80"
          aria-label={t("historyLinkAria")}
        >
          <span
            className="material-symbols-outlined text-2xl"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            history
          </span>
        </Link>
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col touch-pan-y min-h-[calc(100dvh-8rem)]"
        style={{ touchAction: "pan-y" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {!currentUserId && (
          <div className="mx-4 mt-1 flex items-center gap-3 rounded-2xl bg-brand/10 px-4 py-3">
            <span
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
          <div className="relative flex rounded-full bg-muted p-1">
            <motion.div
              layout
              className="absolute inset-y-1 rounded-full bg-brand"
              style={{
                width: "calc(33.333% - 5px)",
                left: indicatorLeft,
              }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
            />
            {PERIOD_ORDER.map((tab) => (
              <button
                key={tab}
                type="button"
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

        <div className="flex flex-1 flex-col">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <span
                className="material-symbols-outlined mb-4 text-4xl text-muted-foreground"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                emoji_events
              </span>
              <p className="text-sm font-medium text-muted-foreground">
                {isLoading ? t("loading") : t("emptyPeriod")}
              </p>
            </div>
          ) : (
            <>
              <LeaderboardPodiumAndList
                entries={entries}
                currentUserId={currentUserId}
                formatPoints={formatPoints}
                getDisplayName={getDisplayName}
                t={t}
              />
            </>
          )}
        </div>
        <div className="min-h-24 flex-shrink-0" aria-hidden />
      </div>
    </div>
  );
}
