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

export async function getUserStats(userId: string): Promise<UserStats | null> {
  const supabase = await createClient();

  const [leaderboardRes, avgRes] = await Promise.all([
    supabase
      .from("ecos_leaderboard")
      .select("total_points, games_played, games_won, streak, max_streak, global_rank")
      .eq("user_id", userId)
      .single(),
    supabase.rpc("get_user_avg_guesses", { p_user_id: userId }),
  ]);

  const { data, error } = leaderboardRes;
  const avgGuesses = typeof avgRes.data === "number" ? avgRes.data : 0;

  if (error || !data) {
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

  return {
    ...data,
    max_streak: (data as { max_streak?: number }).max_streak ?? 0,
    avg_guesses: avgGuesses,
  };
}

  export interface LeaderboardEntryRow {
  user_id: string;
  total_points: number;
  streak: number;
  global_rank: number;
  profiles: { display_name: string; avatar_url: string } | null;
}

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntryRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ecos_leaderboard")
    .select(
      `
      user_id, total_points, streak, global_rank,
      profiles:ecos_profiles!user_id (
        display_name, avatar_url
      )
    `
    )
    .order("total_points", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []).map((r) => ({
    user_id: r.user_id,
    total_points: r.total_points,
    streak: r.streak ?? 0,
    global_rank: r.global_rank ?? 0,
    profiles: r.profiles,
  }));
}

export type LeaderboardPeriod = "weekly" | "monthly" | "global";

export async function getLeaderboardByPeriod(
  period: LeaderboardPeriod,
  limit = 50
): Promise<LeaderboardEntryRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_leaderboard_by_period", {
    p_period: period,
    p_limit: limit,
    p_search: null,
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
      display_name: string | null;
      avatar_url: string | null;
    }) => ({
      user_id: r.user_id,
      total_points: Number(r.total_points),
      streak: r.streak ?? 0,
      global_rank: r.global_rank ?? 0,
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
