import { getEffectiveGameDate } from "@/lib/date-utils";
import { createClient } from "@/lib/supabase/server";

export type LeaderboardHistoryGranularity = "weekly" | "monthly";

export interface LeaderboardPeriodSummaryRow {
  period_start: string;
  period_end: string;
  winner_user_id: string | null;
  winner_points: number | null;
  winner_display_name: string | null;
  winner_avatar_url: string | null;
}

export async function getLeaderboardPeriodSummaries(
  granularity: LeaderboardHistoryGranularity,
  count?: number
): Promise<LeaderboardPeriodSummaryRow[]> {
  const supabase = await createClient();
  const n =
    granularity === "weekly"
      ? Math.min(Math.max(1, count ?? 12), 52)
      : null;

  const { data, error } = await supabase.rpc("get_leaderboard_period_summaries", {
    p_granularity: granularity,
    p_count: n,
  });

  if (error) {
    console.error("getLeaderboardPeriodSummaries error:", error);
    return [];
  }

  const rows: LeaderboardPeriodSummaryRow[] = (data ?? []).map(
    (r: {
      period_start: string;
      period_end: string;
      winner_user_id: string | null;
      winner_points: number | null;
      winner_display_name: string | null;
      winner_avatar_url: string | null;
    }) => ({
      period_start: r.period_start,
      period_end: r.period_end,
      winner_user_id: r.winner_user_id,
      winner_points:
        r.winner_points != null ? Number(r.winner_points) : null,
      winner_display_name: r.winner_display_name,
      winner_avatar_url: r.winner_avatar_url,
    })
  );

  if (granularity !== "monthly") return rows;

  const currentMonthKey = getEffectiveGameDate().slice(0, 7);
  return rows.filter((r) => r.period_start.slice(0, 7) < currentMonthKey);
}
