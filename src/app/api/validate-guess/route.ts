import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { calculateScore } from "@/lib/scoring";
import { z } from "zod";

const GuessSchema = z.object({
  gameId: z.string().uuid(),
  userId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(6),
  guessText: z.string().min(1).max(500),
  deezerTrackId: z.number(),
  finalize: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = GuessSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { gameId, userId, attemptNumber, guessText, deezerTrackId, finalize } =
      parsed.data;

    const supabase = await createServiceClient();

    // Obtener el juego y la canción correcta
    const { data: game, error: gameError } = await supabase
      .from("ecos_games")
      .select("id, ecos_songs(id, deezer_id, title, artist_name)")
      .eq("id", gameId)
      .single();

    if (gameError || !game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    const song = (game.ecos_songs as unknown) as {
      id: string;
      deezer_id: number;
      title: string;
      artist_name: string;
    } | null;

    if (!song) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 });
    }
    const isCorrect =
      deezerTrackId === song.deezer_id ||
      guessText.toLowerCase().includes(song.title.toLowerCase());

    // Registrar el intento
    await supabase.from("ecos_guesses").upsert({
      user_id: userId,
      game_id: gameId,
      attempt_number: attemptNumber,
      guess_text: guessText,
      correct: isCorrect,
    });

    if (!finalize) {
      return NextResponse.json({ correct: isCorrect });
    }

    // Si finalize=true, calcular y guardar puntuación
    if (!isCorrect && attemptNumber < 6) {
      return NextResponse.json({ correct: false });
    }

    // Obtener racha del usuario
    const { data: leaderboard } = await supabase
      .from("ecos_leaderboard")
      .select("streak")
      .eq("user_id", userId)
      .single();

    const streak = (leaderboard?.streak ?? 0) + 1;
    const scoreResult = isCorrect
      ? calculateScore(attemptNumber, streak)
      : { basePoints: 0, streakBonus: 0, totalPoints: 0 };

    // Guardar puntuación
    await supabase.from("ecos_scores").upsert({
      user_id: userId,
      game_id: gameId,
      points: scoreResult.totalPoints,
      guesses_used: attemptNumber,
      correct: isCorrect,
    });

    // Actualizar leaderboard
    await supabase.rpc("ecos_update_leaderboard", {
      p_user_id: userId,
      p_points: scoreResult.totalPoints,
      p_won: isCorrect,
      p_streak: isCorrect ? streak : 0,
    });

    return NextResponse.json({
      correct: isCorrect,
      ...scoreResult,
    });
  } catch (err) {
    console.error("validate-guess error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
