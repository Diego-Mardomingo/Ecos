"use client";

import { motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  leaderboardHeaderGridClass,
  leaderboardRowGridClass,
} from "@/components/leaderboard/leaderboard-grid-classes";

export interface LeaderboardEntry {
  user_id: string;
  total_points: number;
  streak: number;
  global_rank: number;
  aciertos: number;
  profiles: {
    display_name: string;
    avatar_url: string;
  } | null;
}

export {
  leaderboardHeaderGridClass,
  leaderboardRowGridClass,
} from "@/components/leaderboard/leaderboard-grid-classes";

type RankingT = {
  (key: string): string;
  (key: string, values?: Record<string, string | number | Date>): string;
};

export function LeaderboardPodiumAndList({
  entries,
  currentUserId,
  formatPoints,
  getDisplayName,
  t,
}: {
  entries: LeaderboardEntry[];
  currentUserId: string | null;
  formatPoints: (n: number) => string;
  getDisplayName: (entry: LeaderboardEntry) => string;
  t: RankingT;
}) {
  const top3 = entries.slice(0, 3);
  const allListEntries = entries;

  const isCurrentUser = (id: string) => id === currentUserId;

  return (
    <>
      <div className="px-4 py-6">
        <div className="flex items-end justify-center gap-4">
          <PodiumEntry
            entry={top3[1]}
            position={2}
            isCurrentUser={isCurrentUser(top3[1]?.user_id ?? "")}
            formatPoints={formatPoints}
            getDisplayName={getDisplayName}
            earlySupporterLabel={t("earlySupporterBadge")}
            podiumHitsLabel={t("hitsPodiumLine", { count: top3[1]?.aciertos ?? 0 })}
          />
          <PodiumEntry
            entry={top3[0]}
            position={1}
            isCurrentUser={isCurrentUser(top3[0]?.user_id ?? "")}
            formatPoints={formatPoints}
            elevated
            getDisplayName={getDisplayName}
            earlySupporterLabel={t("earlySupporterBadge")}
            podiumHitsLabel={t("hitsPodiumLine", { count: top3[0]?.aciertos ?? 0 })}
          />
          <PodiumEntry
            entry={top3[2]}
            position={3}
            isCurrentUser={isCurrentUser(top3[2]?.user_id ?? "")}
            formatPoints={formatPoints}
            getDisplayName={getDisplayName}
            earlySupporterLabel={t("earlySupporterBadge")}
            podiumHitsLabel={t("hitsPodiumLine", { count: top3[2]?.aciertos ?? 0 })}
          />
        </div>
      </div>

      <div className="px-4">
        <div
          className={cn(
            leaderboardHeaderGridClass,
            "text-[11px] font-semibold leading-snug tracking-wide text-muted-foreground sm:text-xs"
          )}
        >
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="block w-1 shrink-0" aria-hidden />
            <span className="block w-[2.75rem] shrink-0" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="text-left">{t("user")}</span>
            <span className="shrink-0 text-right">{t("totalPoints")}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1 pb-4">
          {allListEntries.map((entry, i) => (
            <motion.div
              key={entry.user_id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className={cn(
                "rounded-2xl transition-colors",
                isCurrentUser(entry.user_id)
                  ? "border border-brand/30 bg-brand/10"
                  : "bg-card"
              )}
            >
              <div className={leaderboardRowGridClass}>
                <div className="flex shrink-0 items-center gap-1.5">
                  <div
                    className="flex h-8 w-1 shrink-0 items-center justify-center"
                    aria-hidden
                  >
                    {isCurrentUser(entry.user_id) ? (
                      <div className="h-full min-h-[1.5rem] w-1 rounded-full bg-brand" />
                    ) : null}
                  </div>
                  <span className="min-w-[2.75rem] shrink-0 text-left text-sm font-bold tabular-nums leading-none text-muted-foreground">
                    #{entry.global_rank ?? i + 1}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={entry.profiles?.avatar_url} />
                    <AvatarFallback className="bg-secondary text-xs font-bold">
                      {getDisplayName(entry).slice(0, 2).toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5">
                      <p
                        className={cn(
                          "m-0 min-w-0 break-words text-sm font-semibold leading-tight line-clamp-2",
                          isCurrentUser(entry.user_id) && "text-brand"
                        )}
                      >
                        {isCurrentUser(entry.user_id)
                          ? t("youLabel")
                          : getDisplayName(entry)}
                      </p>
                      <span
                        className="inline-flex h-6 w-6 shrink-0 translate-y-2 items-center justify-center justify-self-end rounded-full bg-sky-500/25 text-sky-500"
                        title={t("earlySupporterBadge")}
                        aria-hidden
                      >
                        <span aria-hidden
                          className="material-symbols-outlined select-none leading-none"
                          style={{
                            fontVariationSettings: "'FILL' 1",
                            fontSize: "12px",
                            lineHeight: 1,
                          }}
                        >
                          volunteer_activism
                        </span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                      <span>{t("hitsLabel")}</span>{" "}
                      <span className="font-semibold tabular-nums text-brand">
                        {entry.aciertos}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end self-center">
                  <span className="text-right text-sm font-bold tabular-nums leading-none">
                    {formatPoints(entry.total_points)}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
}

function PodiumEntry({
  entry,
  position,
  isCurrentUser,
  formatPoints,
  elevated,
  getDisplayName,
  earlySupporterLabel,
  podiumHitsLabel,
}: {
  entry: LeaderboardEntry | undefined;
  position: 1 | 2 | 3;
  isCurrentUser: boolean;
  formatPoints: (n: number) => string;
  elevated?: boolean;
  getDisplayName: (e: LeaderboardEntry) => string;
  earlySupporterLabel: string;
  podiumHitsLabel: string;
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
        <div className="flex items-center justify-center gap-1.5">
          <p className="m-0 max-w-[80px] truncate text-xs font-semibold leading-tight">
            {displayName}
          </p>
          <span
            className="inline-flex h-5 w-5 shrink-0 translate-y-1 items-center justify-center rounded-full bg-sky-500/25 text-sky-500"
            title={earlySupporterLabel}
            aria-hidden
          >
            <span aria-hidden
              className="material-symbols-outlined select-none leading-none"
              style={{
                fontVariationSettings: "'FILL' 1",
                fontSize: "10px",
                lineHeight: 1,
              }}
            >
              volunteer_activism
            </span>
          </span>
        </div>
        <p className="text-xs font-bold text-brand">{formatPoints(entry.total_points)}</p>
        <p className="max-w-[100px] truncate text-[10px] font-medium leading-tight text-muted-foreground sm:text-xs">
          {podiumHitsLabel}
        </p>
      </div>
      <div className={cn("w-full rounded-t-lg", barHeights[position], barColors[position])} />
    </div>
  );
}
