import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getTodaysGame,
  getPreviousDays,
  getInProgressGames,
  getTodaysCompletedResult,
} from "@/lib/queries/games";
import { getUserStats, getLeaderboardByPeriod } from "@/lib/queries/users";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const [todaysGame, previousDays, userStats] = await Promise.all([
      getTodaysGame(),
      getPreviousDays(user?.id ?? null),
      user ? getUserStats(user.id) : null,
    ]);

    let rankingRanks: { global: number | null; weekly: number | null; monthly: number | null } | undefined;
    if (user?.id) {
      const [weeklyEntries, monthlyEntries] = await Promise.all([
        getLeaderboardByPeriod("weekly", 150),
        getLeaderboardByPeriod("monthly", 150),
      ]);
      const weeklyEntry = weeklyEntries.find((e) => e.user_id === user.id);
      const monthlyEntry = monthlyEntries.find((e) => e.user_id === user.id);
      rankingRanks = {
        global: userStats?.global_rank ?? null,
        weekly: weeklyEntry?.global_rank ?? null,
        monthly: monthlyEntry?.global_rank ?? null,
      };
    }

    const [inProgressByGameId, todaysCompletedResult] = await Promise.all([
      user && (todaysGame || previousDays.length > 0)
        ? getInProgressGames(
            user.id,
            todaysGame?.id ?? null,
            previousDays.map((d) => d.id)
          )
        : {},
      user && todaysGame ? getTodaysCompletedResult(user.id, todaysGame.id) : null,
    ]);

    return NextResponse.json({
      todaysGame,
      previousDays,
      userStats,
      userId: user?.id ?? null,
      inProgressByGameId,
      todaysCompletedResult,
      rankingRanks,
    });
  } catch (err) {
    console.error("api/home error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
