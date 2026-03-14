"use client";

import { useState, useCallback, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import { useLeaderboard } from "@/lib/hooks/queries";
import { useLeaderboardRealtime } from "@/lib/realtime/useLeaderboardRealtime";
import { cn } from "@/lib/utils";

interface LeaderboardEntry {
  user_id: string;
  total_points: number;
  streak: number;
  global_rank: number;
  profiles: {
    display_name: string;
    avatar_url: string;
  } | null;
}

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

  const { data, isLoading } = useLeaderboard(activeTab, initialData);
  useLeaderboardRealtime();
  const entries = data?.entries ?? [];

  const lastUserIdRef = useRef<string | null>(null);
  if (data?.currentUserId !== undefined) {
    lastUserIdRef.current = data.currentUserId;
  }
  const currentUserId = data?.currentUserId ?? lastUserIdRef.current;

  const formatPoints = useCallback(
    (n: number) => n.toLocaleString(locale === "es" ? "es-ES" : "en-US"),
    [locale]
  );

  const top3 = entries.slice(0, 3);
  const allListEntries = entries;

  const isCurrentUser = (id: string) => id === currentUserId;

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
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 pt-safe backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--background) 85%, transparent)" }}
      >
        <div className="flex h-9 w-9" aria-hidden />
        <h1 className="text-base font-bold">{t("title")}</h1>
        <div className="flex h-9 w-9" aria-hidden />
      </header>

      {/* Banner de invitado */}
      {!currentUserId && (
        <div className="mx-4 mt-1 flex items-center gap-3 rounded-2xl bg-brand/10 px-4 py-3">
          <span
            className="material-symbols-outlined text-xl text-brand"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            emoji_events
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">¿Quieres competir?</p>
            <p className="text-xs text-muted-foreground">
              Inicia sesión para aparecer en el ranking global.
            </p>
          </div>
          <Link
            href="/login?redirect=/ranking"
            className="flex-shrink-0 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-[#0a2015]"
          >
            Entrar
          </Link>
        </div>
      )}

      {/* Toggle Semanal / Mensual / Global */}
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
                activeTab === tab ? "text-[#0a2015]" : "text-muted-foreground"
              )}
            >
              {t(tab)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
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
            {/* Podio Top 3 */}
            <div className="px-4 py-6">
              <div className="flex items-end justify-center gap-4">
                <PodiumEntry entry={top3[1]} position={2} isCurrentUser={isCurrentUser(top3[1]?.user_id ?? "")} formatPoints={formatPoints} getDisplayName={getDisplayName} />
                <PodiumEntry entry={top3[0]} position={1} isCurrentUser={isCurrentUser(top3[0]?.user_id ?? "")} formatPoints={formatPoints} elevated getDisplayName={getDisplayName} />
                <PodiumEntry entry={top3[2]} position={3} isCurrentUser={isCurrentUser(top3[2]?.user_id ?? "")} formatPoints={formatPoints} getDisplayName={getDisplayName} />
              </div>
            </div>

            {/* Cabecera de tabla */}
            <div className="flex items-center px-4 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="w-10">{t("rank")}</span>
              <span className="flex-1">{t("user")}</span>
              <span className="w-16 text-center">{t("streak")}</span>
              <span className="w-16 text-right">{t("totalPoints")}</span>
            </div>

            {/* Lista - todos los entries numerados desde 1 */}
            <div className="flex flex-col px-4 pb-28 gap-1">
          {allListEntries.map((entry, i) => (
            <motion.div
              key={entry.user_id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className={cn(
                "flex items-center rounded-2xl px-3 py-3 transition-colors",
                isCurrentUser(entry.user_id)
                  ? "border border-brand/30 bg-brand/10"
                  : "bg-card"
              )}
            >
              {isCurrentUser(entry.user_id) && (
                <div className="mr-2 h-full w-1 rounded-full bg-brand" />
              )}
              <span className="w-10 text-sm font-bold text-muted-foreground">
                #{entry.global_rank ?? i + 1}
              </span>
              <div className="flex flex-1 items-center gap-2.5">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={entry.profiles?.avatar_url} />
                  <AvatarFallback className="bg-secondary text-xs font-bold">
                    {getDisplayName(entry).slice(0, 2).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-1.5">
                  <p className={cn("text-sm font-semibold", isCurrentUser(entry.user_id) && "text-brand")}>
                    {isCurrentUser(entry.user_id) ? t("youLabel") : getDisplayName(entry)}
                  </p>
                  <span
                    className="material-symbols-outlined text-sky-500"
                    style={{ fontVariationSettings: "'FILL' 1", fontSize: '14px' }}
                    title={t("earlySupporterBadge")}
                    aria-hidden
                  >
                    volunteer_activism
                  </span>
                </div>
              </div>
              <div className="flex w-16 items-center justify-center gap-1">
                <span className="material-symbols-outlined text-sm text-orange-400"
                  style={{ fontVariationSettings: "'FILL' 1" }}>
                  local_fire_department
                </span>
                <span className="text-sm font-medium">{entry.streak}</span>
              </div>
              <span className="w-16 text-right text-sm font-bold tabular-nums">
                {formatPoints(entry.total_points)}
              </span>
            </motion.div>
          ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PodiumEntry({
  entry,
  position,
  isCurrentUser,
  formatPoints,
  elevated,
  getDisplayName,
}: {
  entry: LeaderboardEntry | undefined;
  position: 1 | 2 | 3;
  isCurrentUser: boolean;
  formatPoints: (n: number) => string;
  elevated?: boolean;
  getDisplayName: (e: LeaderboardEntry) => string;
}) {
  if (!entry) return <div className="flex-1" />;

  const displayName = getDisplayName(entry);

  const borderColors = {
    1: "ring-brand",
    2: "ring-gray-400",
    3: "ring-[#cd7f32]",
  };

  const barHeights = { 1: "h-16", 2: "h-10", 3: "h-8" };
  const barColors = {
    1: "bg-gradient-to-t from-brand to-brand/60",
    2: "bg-gradient-to-t from-gray-400 to-gray-400/60",
    3: "bg-gradient-to-t from-[#cd7f32] to-[#cd7f32]/60",
  };

  const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };

  return (
    <div className={cn("flex flex-1 flex-col items-center gap-2", elevated && "-mb-2")}>
      <div className="relative">
        {position === 1 && (
          <motion.span
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute -top-5 left-1/2 -translate-x-1/2 text-lg"
          >
            👑
          </motion.span>
        )}
        <Avatar
          className={cn(
            "ring-2",
            elevated ? "h-16 w-16" : "h-12 w-12",
            borderColors[position]
          )}
        >
          <AvatarImage src={entry.profiles?.avatar_url} />
          <AvatarFallback className="bg-secondary font-bold">
            {displayName.slice(0, 2).toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
        <span className="absolute -bottom-1 -right-1 text-base">{medals[position]}</span>
      </div>
      <div className="text-center">
        <div className="flex items-center justify-center gap-1">
          <p className="max-w-[80px] truncate text-xs font-semibold">
            {displayName}
          </p>
          <span
            className="material-symbols-outlined text-sky-500 shrink-0"
            style={{ fontVariationSettings: "'FILL' 1", fontSize: '14px' }}
            aria-hidden
          >
            volunteer_activism
          </span>
        </div>
        <p className="text-xs font-bold text-brand">
          {formatPoints(entry.total_points)}
        </p>
      </div>
      <div className={cn("w-full rounded-t-lg", barHeights[position], barColors[position])} />
    </div>
  );
}
