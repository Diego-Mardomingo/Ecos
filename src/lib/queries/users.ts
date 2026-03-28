import { createClient } from "@/lib/supabase/server";

export interface UserStats {
  total_points: number;
  games_played: number;
  games_won: number;
  streak: number;
  max_streak: number;
  global_rank: number | null;
  avg_guesses: number;
}

/** Respuesta de `get_user_ranking_stats` (Supabase devuelve una fila). */
type RankingStatsRow = {
  total_points: number | null;
  games_played: number | null;
  games_won: number | null;
  global_rank: number | null;
  streak: number | null;
  max_streak: number | null;
  weekly_points: number | null;
  weekly_rank: number | null;
  weekly_aciertos: number | null;
  monthly_points: number | null;
  monthly_rank: number | null;
  monthly_aciertos: number | null;
};

function mapRankingRowToUserStats(
  r: RankingStatsRow,
  avgGuesses: number
): UserStats {
  return {
    total_points: Number(r.total_points ?? 0),
    games_played: Number(r.games_played ?? 0),
    games_won: Number(r.games_won ?? 0),
    streak: Number(r.streak ?? 0),
    max_streak: Number(r.max_streak ?? 0),
    global_rank: r.global_rank != null ? Number(r.global_rank) : null,
    avg_guesses: avgGuesses,
  };
}

export async function getUserStats(userId: string): Promise<UserStats | null> {
  const supabase = await createClient();

  const [rankRes, avgRes] = await Promise.all([
    supabase.rpc("get_user_ranking_stats", { p_user_id: userId }),
    supabase.rpc("get_user_avg_guesses", { p_user_id: userId }),
  ]);

  const avgGuesses = typeof avgRes.data === "number" ? avgRes.data : 0;

  if (rankRes.error) {
    console.error("get_user_ranking_stats:", rankRes.error);
    return {
      total_points: 0,
      games_played: 0,
      games_won: 0,
      streak: 0,
      max_streak: 0,
      global_rank: null,
      avg_guesses: avgGuesses,
    };
  }

  const raw = rankRes.data;
  const row = (Array.isArray(raw) ? raw[0] : raw) as RankingStatsRow | undefined;
  if (!row) {
    return {
      total_points: 0,
      games_played: 0,
      games_won: 0,
      streak: 0,
      max_streak: 0,
      global_rank: null,
      avg_guesses: avgGuesses,
    };
  }

  return mapRankingRowToUserStats(row, avgGuesses);
}

export interface UserDashboardStats {
  userStats: UserStats;
  rankingRanks: { global: number | null; weekly: number | null; monthly: number | null };
  rankingStats: {
    global: { points: number; rank: number | null };
    weekly: { points: number; rank: number | null };
    monthly: { points: number; rank: number | null };
  };
}

/** Una sola llamada RPC: stats globales y rankings semanal/mensual sin límite de top-N. */
export async function getUserDashboardStats(userId: string): Promise<UserDashboardStats> {
  const supabase = await createClient();

  const [rankRes, avgRes] = await Promise.all([
    supabase.rpc("get_user_ranking_stats", { p_user_id: userId }),
    supabase.rpc("get_user_avg_guesses", { p_user_id: userId }),
  ]);

  const avgGuesses = typeof avgRes.data === "number" ? avgRes.data : 0;

  if (rankRes.error) {
    console.error("get_user_ranking_stats:", rankRes.error);
    const empty: UserStats = {
      total_points: 0,
      games_played: 0,
      games_won: 0,
      streak: 0,
      max_streak: 0,
      global_rank: null,
      avg_guesses: avgGuesses,
    };
    return {
      userStats: empty,
      rankingRanks: { global: null, weekly: null, monthly: null },
      rankingStats: {
        global: { points: 0, rank: null },
        weekly: { points: 0, rank: null },
        monthly: { points: 0, rank: null },
      },
    };
  }

  const raw = rankRes.data;
  const row = (Array.isArray(raw) ? raw[0] : raw) as RankingStatsRow | undefined;
  if (!row) {
    const empty: UserStats = {
      total_points: 0,
      games_played: 0,
      games_won: 0,
      streak: 0,
      max_streak: 0,
      global_rank: null,
      avg_guesses: avgGuesses,
    };
    return {
      userStats: empty,
      rankingRanks: { global: null, weekly: null, monthly: null },
      rankingStats: {
        global: { points: 0, rank: null },
        weekly: { points: 0, rank: null },
        monthly: { points: 0, rank: null },
      },
    };
  }

  const userStats = mapRankingRowToUserStats(row, avgGuesses);

  return {
    userStats,
    rankingRanks: {
      global: row.global_rank != null ? Number(row.global_rank) : null,
      weekly: row.weekly_rank != null ? Number(row.weekly_rank) : null,
      monthly: row.monthly_rank != null ? Number(row.monthly_rank) : null,
    },
    rankingStats: {
      global: {
        points: Number(row.total_points ?? 0),
        rank: row.global_rank != null ? Number(row.global_rank) : null,
      },
      weekly: {
        points: Number(row.weekly_points ?? 0),
        rank: row.weekly_rank != null ? Number(row.weekly_rank) : null,
      },
      monthly: {
        points: Number(row.monthly_points ?? 0),
        rank: row.monthly_rank != null ? Number(row.monthly_rank) : null,
      },
    },
  };
}

export interface LeaderboardEntryRow {
  user_id: string;
  total_points: number;
  streak: number;
  global_rank: number;
  aciertos: number;
  profiles: { display_name: string; avatar_url: string } | null;
}

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntryRow[]> {
  return getLeaderboardByPeriod("global", limit);
}

export type LeaderboardPeriod = "weekly" | "monthly" | "global";

export async function getLeaderboardByPeriod(
  period: LeaderboardPeriod,
  limit = 50,
  referenceDate?: string | null
): Promise<LeaderboardEntryRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_leaderboard_by_period", {
    p_period: period,
    p_limit: limit,
    p_search: null,
    p_reference_date: referenceDate ?? null,
  });

  if (error) {
    console.error("getLeaderboardByPeriod error:", error);
    return [];
  }

  return (data ?? []).map(
    (r: {
      user_id: string;
      total_points: number;
      streak: number;
      global_rank: number;
      aciertos?: number;
      display_name: string | null;
      avatar_url: string | null;
    }) => ({
      user_id: r.user_id,
      total_points: Number(r.total_points),
      streak: r.streak ?? 0,
      global_rank: r.global_rank ?? 0,
      aciertos: r.aciertos ?? 0,
      profiles:
        r.display_name != null || r.avatar_url != null
          ? {
              display_name: r.display_name ?? "",
              avatar_url: r.avatar_url ?? "",
            }
          : null,
    })
  );
}
