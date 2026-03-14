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
  userStats: (userId: string) => ["user-stats", userId] as const,
  profile: ["profile"] as const,
  search: (q: string) => ["search", q] as const,
};

interface HomeData {
  todaysGame: GameWithSong | null;
  previousDays: PreviousDayGame[];
  userStats: UserStats | null;
  userId: string | null;
  inProgressByGameId?: Record<string, InProgressProgress>;
  todaysCompletedResult?: TodaysCompletedResult | null;
  rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
}

interface RankingData {
  entries: Array<{
    user_id: string;
    total_points: number;
    streak: number;
    global_rank: number;
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
      const res = await fetch("/api/home");
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

export function useProfile(initialData?: ProfileData) {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: async (): Promise<ProfileData> => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
    initialData,
    retry: false,
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
