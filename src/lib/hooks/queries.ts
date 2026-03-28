"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  GameWithSong,
  PreviousDayGame,
  InProgressProgress,
  TodaysCompletedResult,
} from "@/lib/queries/games";

export type { InProgressProgress, TodaysCompletedResult };
import type { UserStats } from "@/lib/queries/users";

export const queryKeys = {
  home: ["home"] as const,
  game: (id: string) => ["game", id] as const,
  leaderboard: (period: string) => ["leaderboard", period] as const,
  leaderboardHistorySummaries: (granularity: string) =>
    ["leaderboard-history-summaries", granularity] as const,
  leaderboardHistoryDetail: (granularity: string, anchor: string) =>
    ["leaderboard-history-detail", granularity, anchor] as const,
  userStats: (userId: string) => ["user-stats", userId] as const,
  profile: ["profile"] as const,
  search: (q: string) => ["search", q] as const,
};

export interface RankingStatsPeriod {
  points: number;
  rank: number | null;
}

export interface HomeData {
  todaysGame: GameWithSong | null;
  previousDays: PreviousDayGame[];
  userStats: UserStats | null;
  userId: string | null;
  inProgressByGameId?: Record<string, InProgressProgress>;
  todaysCompletedResult?: TodaysCompletedResult | null;
  rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
  rankingStats?: {
    global: RankingStatsPeriod;
    weekly: RankingStatsPeriod;
    monthly: RankingStatsPeriod;
  };
}

interface RankingData {
  entries: Array<{
    user_id: string;
    total_points: number;
    streak: number;
    global_rank: number;
    aciertos: number;
    profiles: { display_name: string; avatar_url: string } | null;
  }>;
  currentUserId: string | null;
}

interface ProfileData {
  profile: {
    id: string;
    display_name: string;
    avatar_url: string;
    created_at: string;
    email: string;
    role: string | null;
  };
  stats: UserStats | null;
}

export function useHomeData(initialData?: HomeData) {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: async (): Promise<HomeData> => {
      const res = await fetch("/api/home", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch home data");
      return res.json();
    },
    initialData,
  });
}

export function useGameById(gameId: string, initialData?: GameWithSong | null) {
  return useQuery({
    queryKey: queryKeys.game(gameId),
    queryFn: async (): Promise<GameWithSong | null> => {
      const res = await fetch(`/api/game/${gameId}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch game");
      }
      return res.json();
    },
    initialData,
    enabled: !!gameId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLeaderboard(
  period: "weekly" | "monthly" | "global",
  initialData?: RankingData
) {
  return useQuery({
    queryKey: queryKeys.leaderboard(period),
    queryFn: async (): Promise<RankingData> => {
      const res = await fetch(`/api/ranking?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch leaderboard");
      return res.json();
    },
    initialData: period === "global" ? initialData : undefined,
  });
}

export interface LeaderboardHistorySummary {
  period_start: string;
  period_end: string;
  winner_user_id: string | null;
  winner_points: number | null;
  winner_display_name: string | null;
  winner_avatar_url: string | null;
}

export interface LeaderboardHistoryDetailData extends RankingData {
  granularity: "weekly" | "monthly";
  anchor: string;
  periodStart: string;
  periodEnd: string;
}

export function useLeaderboardHistorySummaries(
  granularity: "weekly" | "monthly"
) {
  return useQuery({
    queryKey: queryKeys.leaderboardHistorySummaries(granularity),
    queryFn: async (): Promise<LeaderboardHistorySummary[]> => {
      const url =
        granularity === "monthly"
          ? "/api/ranking/history/summaries?granularity=monthly"
          : "/api/ranking/history/summaries?granularity=weekly&limit=12";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch history summaries");
      const json = (await res.json()) as { summaries: LeaderboardHistorySummary[] };
      return json.summaries ?? [];
    },
    staleTime: 60 * 60 * 1000,
  });
}

export function useLeaderboardHistoryDetail(
  granularity: "weekly" | "monthly",
  anchor: string,
  options?: { enabled?: boolean }
) {
  const enabled =
    (options?.enabled ?? true) &&
    !!anchor &&
    /^\d{4}-\d{2}-\d{2}$/.test(anchor);

  return useQuery({
    queryKey: queryKeys.leaderboardHistoryDetail(granularity, anchor),
    queryFn: async (): Promise<LeaderboardHistoryDetailData> => {
      const res = await fetch(
        `/api/ranking/history/detail?granularity=${granularity}&anchor=${encodeURIComponent(anchor)}`
      );
      if (!res.ok) throw new Error("Failed to fetch history detail");
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
    enabled,
  });
}

export function useProfile(
  initialData?: ProfileData,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: async (): Promise<ProfileData> => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
    initialData,
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

export interface EcosSong {
  id: string;
  title: string;
  artist_name: string;
  album_title?: string | null;
  cover_url: string | null;
  spotify_id: string | null;
}

export function useSearchSongs(query: string) {
  return useQuery({
    queryKey: queryKeys.search(query.trim()),
    queryFn: async (): Promise<EcosSong[]> => {
      const res = await fetch(
        `/api/search-songs?q=${encodeURIComponent(query.trim())}`
      );
      const json = (await res.json()) as { data: EcosSong[] };
      return json.data ?? [];
    },
    enabled: query.trim().length >= 2,
    staleTime: 60 * 1000,
  });
}
