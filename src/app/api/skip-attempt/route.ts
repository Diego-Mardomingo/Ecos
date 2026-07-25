import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { computeFinalizeParams } from "@/lib/ecos-finalize-helpers";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { resolveServerAttempt, MAX_ATTEMPTS } from "@/lib/server-attempt";
import { z } from "zod";

const SkipSchema = z.object({
  gameId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(6),
});

const SKIP_TEXT = "skipped";

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

    const gameDate = (gameData as { date?: string }).date ?? "";

    // select-daily-game.py pre-crea el juego del día siguiente: no se puede jugar por adelantado.
    if (gameDate > getEffectiveGameDate()) {
      return NextResponse.json({ error: "Game not available" }, { status: 403 });
    }

    const serviceSupabase = createServiceClient();

    // El intento no puede venir del cliente: ver src/lib/server-attempt.ts.
    const { data: existingGuesses } = await serviceSupabase
      .from("ecos_guesses")
      .select("attempt_number, guess_text")
      .eq("user_id", user.id)
      .eq("game_id", gameId);

    const serverAttempt = resolveServerAttempt(
      existingGuesses ?? [],
      attemptNumber,
      SKIP_TEXT
    );

    const guessRow = {
      user_id: user.id,
      game_id: gameId,
      attempt_number: serverAttempt,
      guess_text: SKIP_TEXT,
      correct: false,
      correct_artist: false,
      correct_album: false,
    };

    if (serverAttempt >= MAX_ATTEMPTS) {
      const { data: existingScore } = await serviceSupabase
        .from("ecos_scores")
        .select("id")
        .eq("user_id", user.id)
        .eq("game_id", gameId)
        .maybeSingle();

      // Ya cerrada: idempotente, sin repuntuar (un error revertiría el estado en el cliente).
      if (existingScore) {
        return NextResponse.json({ ok: true, alreadyFinalized: true });
      }

      const { data: lb } = await serviceSupabase
        .from("ecos_leaderboard")
        .select("streak, last_played")
        .eq("user_id", user.id)
        .single();

      const { newStreak, updateStreak, scoreResult } = computeFinalizeParams({
        gameDate,
        isCorrect: false,
        attemptNumber: serverAttempt,
        leaderboard: lb ?? null,
      });

      const { error: finalizeError } = await serviceSupabase.rpc("ecos_guess_and_finalize_score", {
        p_user_id: user.id,
        p_game_id: gameId,
        p_attempt_number: serverAttempt,
        p_guess_text: SKIP_TEXT,
        p_correct: false,
        p_correct_artist: false,
        p_correct_album: false,
        p_points: scoreResult.totalPoints,
        p_guesses_used: serverAttempt,
        p_won: false,
        p_streak: newStreak,
        p_update_streak: updateStreak,
      });
      if (finalizeError) {
        console.error("ecos_guess_and_finalize_score (skip):", finalizeError);
        return NextResponse.json({ error: "Failed to save score" }, { status: 500 });
      }

      revalidateTag("games", "max");
      return NextResponse.json({ ok: true, attemptNumber: serverAttempt });
    }

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

    return NextResponse.json({ ok: true, attemptNumber: serverAttempt });
  } catch (err) {
    console.error("skip-attempt error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}