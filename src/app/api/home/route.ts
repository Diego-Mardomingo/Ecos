import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getPreviousDaysCached,
  getTodaysGame,
  getTodaysGameCached,
  getPreviousDays,
  getInProgressGames,
  getTodaysCompletedResult,
} from "@/lib/queries/games";
import { getUserDashboardStats } from "@/lib/queries/users";
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

    const useExplicitEffectiveDate = !!effectiveDate;
    const [todaysGame, previousDays, dashboard] = await Promise.all([
      useExplicitEffectiveDate
        ? getTodaysGame(effectiveDate)
        : getTodaysGameCached(),
      useExplicitEffectiveDate
        ? getPreviousDays(user?.id ?? null, undefined, effectiveDate)
        : getPreviousDaysCached(user?.id ?? null),
      user ? getUserDashboardStats(user.id) : Promise.resolve(undefined),
    ]);

    const userStats = dashboard?.userStats ?? null;
    const rankingRanks = dashboard?.rankingRanks;
    const rankingStats = dashboard?.rankingStats;

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
