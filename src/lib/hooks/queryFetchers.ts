import type {
  GameProgressData,
  HomeDayStatusData,
  HomePreviousDaysData,
  HomeTodayData,
  HomeUserStatsData,
  ProfileCoreData,
  ProfileStatsData,
  RankingData,
} from "./queryTypes";

/**
 * Fetchers contra las route handlers. Son envoltorios de `fetch` sin ninguna dependencia, y viven
 * aparte para romper el ciclo entre `queries.ts` y `gameCacheSync.ts`: el parcheado de caché
 * necesita algunos de ellos, y `queries.ts` necesita el parcheado.
 */

export async function fetchProfileCoreData(): Promise<ProfileCoreData> {
  const res = await fetch("/api/profile/core");
  if (!res.ok) throw new Error("Failed to fetch profile core");
  return res.json();
}

export async function fetchProfileStatsData(): Promise<ProfileStatsData> {
  const res = await fetch("/api/profile/stats");
  if (!res.ok) throw new Error("Failed to fetch profile stats");
  return res.json();
}

export async function fetchHomePreviousDaysData(
  month: string
): Promise<HomePreviousDaysData> {
  const res = await fetch(
    `/api/home/previous-days?month=${encodeURIComponent(month)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("Failed to fetch previous days");
  return res.json();
}

export async function fetchGameProgressById(
  gameId: string
): Promise<GameProgressData> {
  const res = await fetch(`/api/game-progress/${gameId}`, { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 401 || res.status === 404) {
      return { progress: null };
    }
    throw new Error("Failed to fetch game progress");
  }
  return res.json();
}

export async function fetchHomeTodayData(): Promise<HomeTodayData> {
  const res = await fetch("/api/home/today", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch home today data");
  return res.json();
}

export async function fetchHomeUserStatsData(): Promise<HomeUserStatsData> {
  const res = await fetch("/api/home/user-stats", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch home user stats");
  return res.json();
}

export async function fetchHomeDayStatusById(
  gameId: string
): Promise<HomeDayStatusData> {
  const res = await fetch(`/api/home/day/${gameId}/status`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch day status");
  return res.json();
}

export async function fetchLeaderboardPeriodData(
  period: "weekly" | "monthly" | "global"
): Promise<RankingData> {
  const res = await fetch(`/api/ranking?period=${period}`);
  if (!res.ok) throw new Error("Failed to fetch leaderboard");
  return res.json();
}
