import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getTodaysGame,
  getPreviousDays,
  getInProgressGames,
  getTodaysCompletedResult,
} from "@/lib/queries/games";
import { getUserStats } from "@/lib/queries/users";

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
    });
  } catch (err) {
    console.error("api/home error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
