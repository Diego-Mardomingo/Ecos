import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getTodaysGame,
  getInProgressGames,
  getTodaysCompletedResult,
} from "@/lib/queries/games";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const todaysGame = await getTodaysGame();
    const todaysCompletedResult =
      user && todaysGame ? await getTodaysCompletedResult(user.id, todaysGame.id) : null;

    let todaysInProgress = null;
    if (user && todaysGame) {
      const inProgressByGameId = await getInProgressGames(user.id, todaysGame.id, []);
      todaysInProgress = inProgressByGameId[todaysGame.id] ?? null;
    }

    return NextResponse.json({
      todaysGame,
      todaysCompletedResult,
      todaysInProgress,
      userId: user?.id ?? null,
    });
  } catch (err) {
    console.error("api/home/today error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
