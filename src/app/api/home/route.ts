import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getTodaysGame,
  getPreviousDays,
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

    return NextResponse.json({
      todaysGame,
      previousDays,
      userStats,
      userId: user?.id ?? null,
    });
  } catch (err) {
    console.error("api/home error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
