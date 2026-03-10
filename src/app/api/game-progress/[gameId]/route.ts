import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/game-progress/[gameId]
 * Returns saved progress for a game (guesses + score) for the current user.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;

    if (!gameId) {
      return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: score } = await supabase
      .from("ecos_scores")
      .select("points, guesses_used, correct")
      .eq("user_id", user.id)
      .eq("game_id", gameId)
      .single();

    if (!score) {
      return NextResponse.json({ progress: null });
    }

    const { data: guesses } = await supabase
      .from("ecos_guesses")
      .select("guess_text, correct, correct_artist, correct_album, attempt_number")
      .eq("user_id", user.id)
      .eq("game_id", gameId)
      .order("attempt_number", { ascending: true });

    const { data: game } = await supabase
      .from("ecos_games")
      .select("date, ecos_songs(title, artist_name, cover_url)")
      .eq("id", gameId)
      .single();

    const songRaw = game?.ecos_songs as unknown;
    const song =
      songRaw && typeof songRaw === "object" && !Array.isArray(songRaw)
        ? (songRaw as { title: string; artist_name: string; cover_url: string })
        : null;

    const progress = {
      gameId,
      gameDate: game?.date ?? "",
      played: true,
      won: score.correct,
      score: score.points,
      title: song?.title,
      artist_name: song?.artist_name,
      cover_url: song?.cover_url,
      guesses: (guesses ?? []).map((g) => ({
        text: g.guess_text,
        correct: g.correct,
        correctArtist: g.correct_artist ?? false,
        correctAlbum: g.correct_album ?? false,
        attemptNumber: g.attempt_number,
      })),
      phase: score.correct ? ("won" as const) : ("lost" as const),
      correctAttempt: score.correct ? score.guesses_used : undefined,
    };

    return NextResponse.json({ progress });
  } catch (err) {
    console.error("game-progress error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
