import { createClient } from "@/lib/supabase/server";

export interface UserStats {
  total_points: number;
  games_played: number;
  games_won: number;
  streak: number;
  global_rank: number | null;
  avg_guesses: number;
}

export async function getUserStats(userId: string): Promise<UserStats | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ecos_leaderboard")
    .select("total_points, games_played, games_won, streak, global_rank, avg_guesses")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return {
      total_points: 0,
      games_played: 0,
      games_won: 0,
      streak: 0,
      global_rank: null,
      avg_guesses: 0,
    };
  }

  return data;
}

export async function getLeaderboard(limit = 50) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ecos_leaderboard")
    .select(
      `
      user_id, total_points, games_played, games_won,
      streak, global_rank, avg_guesses,
      profiles:ecos_profiles!user_id (
        display_name, avatar_url
      )
    `
    )
    .order("total_points", { ascending: false })
    .limit(limit);

  if (error) return [];
  return data ?? [];
}
