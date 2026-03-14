import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { z } from "zod";

const SkipSchema = z.object({
  gameId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(6),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = SkipSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { gameId, attemptNumber } = parsed.data;

    const { data: gameData, error: gameError } = await supabase
      .from("ecos_games")
      .select("id, date")
      .eq("id", gameId)
      .single();

    if (gameError || !gameData) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    const guessRow = {
      user_id: user.id,
      game_id: gameId,
      attempt_number: attemptNumber,
      guess_text: "skipped",
      correct: false,
      correct_artist: false,
      correct_album: false,
    };

    const { error: upsertError } = await supabase
      .from("ecos_guesses")
      .upsert(guessRow, { onConflict: "user_id,game_id,attempt_number" });

    if (upsertError) {
      const { error: insertError } = await supabase.from("ecos_guesses").insert(guessRow);
      if (insertError) {
        if (insertError.code === "23505") return NextResponse.json({ ok: true });
        console.error("skip-attempt error:", insertError);
        return NextResponse.json({ error: "Failed to save skip" }, { status: 500 });
      }
    }

    // Si es el último intento (6), registrar la partida como perdida en ecos_scores
    if (attemptNumber === 6) {
      const serviceSupabase = createServiceClient();
      const { data: existingScore } = await serviceSupabase
        .from("ecos_scores")
        .select("id")
        .eq("user_id", user.id)
        .eq("game_id", gameId)
        .single();

      if (!existingScore) {
        const gameDate = (gameData as { date?: string }).date ?? "";
        const todayMadrid = getEffectiveGameDate();
        const isTodaysGame = gameDate === todayMadrid;

        let currentStreak = 0;
        if (!isTodaysGame) {
          const { data: lb } = await serviceSupabase
            .from("ecos_leaderboard")
            .select("streak")
            .eq("user_id", user.id)
            .single();
          currentStreak = lb?.streak ?? 0;
        }

        await serviceSupabase.from("ecos_scores").upsert({
          user_id: user.id,
          game_id: gameId,
          points: 0,
          guesses_used: 6,
          correct: false,
        });

        await serviceSupabase.rpc("ecos_update_leaderboard", {
          p_user_id: user.id,
          p_points: 0,
          p_won: false,
          p_streak: isTodaysGame ? 0 : currentStreak,
          p_update_streak: isTodaysGame,
        });

        revalidateTag("games", "max");
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("skip-attempt error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
