import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

    const { error: gameError } = await supabase
      .from("ecos_games")
      .select("id")
      .eq("id", gameId)
      .single();

    if (gameError) {
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("skip-attempt error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
