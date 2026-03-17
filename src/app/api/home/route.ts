import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getTodaysGame,
  getPreviousDays,
  getInProgressGames,
  getTodaysCompletedResult,
} from "@/lib/queries/games";
import { getUserStats, getLeaderboardByPeriod } from "@/lib/queries/users";
import {
  getEffectiveGameDate,
  getTomorrowMadridDate,
  getMsUntilNextMidnightMadrid,
} from "@/lib/date-utils";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const effectiveDateParam = searchParams.get("effectiveDate");

    let effectiveDate: string | undefined;
    if (effectiveDateParam) {
      const today = getEffectiveGameDate();
      const tomorrow = getTomorrowMadridDate();
      const msUntilMidnight = getMsUntilNextMidnightMadrid();
      const isTomorrowAllowed = msUntilMidnight < 60_000; // solo últimos 60s antes de medianoche Madrid
      if (
        effectiveDateParam === today ||
        (effectiveDateParam === tomorrow && isTomorrowAllowed)
      ) {
        effectiveDate = effectiveDateParam;
      }
      // si no es hoy ni mañana permitido, ignoramos effectiveDate y usamos "hoy" real
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const [todaysGame, previousDays, userStats] = await Promise.all([
      getTodaysGame(effectiveDate),
      getPreviousDays(user?.id ?? null, undefined, effectiveDate),
      user ? getUserStats(user.id) : null,
    ]);

    let rankingRanks: { global: number | null; weekly: number | null; monthly: number | null } | undefined;
    let rankingStats:
      | {
          global: { points: number; rank: number | null };
          weekly: { points: number; rank: number | null };
          monthly: { points: number; rank: number | null };
        }
      | undefined;
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
      rankingStats = {
        global: {
          points: userStats?.total_points ?? 0,
          rank: userStats?.global_rank ?? null,
        },
        weekly: {
          points: weeklyEntry?.total_points ?? 0,
          rank: weeklyEntry?.global_rank ?? null,
        },
        monthly: {
          points: monthlyEntry?.total_points ?? 0,
          rank: monthlyEntry?.global_rank ?? null,
        },
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
      rankingStats,
    });
  } catch (err) {
    console.error("api/home error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
