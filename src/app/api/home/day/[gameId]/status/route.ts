import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ gameId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { gameId } = await params;
    if (!gameId) {
      return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: game } = await supabase
      .from("ecos_games")
      .select("id, date, ecos_songs(title, artist_name, cover_url)")
      .eq("id", gameId)
      .single();

    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    if (!user) {
      return NextResponse.json({
        gameId,
        played: false,
        won: false,
        score: null,
        title: "",
        artist_name: "",
        cover_url: "",
        inProgress: null,
      });
    }

    const { data: scoreRow } = await supabase
      .from("ecos_scores")
      .select("points, correct")
      .eq("user_id", user.id)
      .eq("game_id", gameId)
      .maybeSingle();

    if (scoreRow) {
      const songRaw = Array.isArray(game.ecos_songs)
        ? game.ecos_songs[0]
        : game.ecos_songs;
      const song = songRaw as {
        title: string;
        artist_name: string;
        cover_url: string | null;
      } | null;

      return NextResponse.json({
        gameId,
        played: true,
        won: scoreRow.correct === true,
        score: scoreRow.points ?? null,
        title: song?.title ?? "",
        artist_name: song?.artist_name ?? "",
        cover_url: song?.cover_url ?? "",
        inProgress: null,
      });
    }

    const { data: guesses } = await supabase
      .from("ecos_guesses")
      .select("guess_text, correct, correct_artist, correct_album, attempt_number")
      .eq("user_id", user.id)
      .eq("game_id", gameId)
      .order("attempt_number", { ascending: true });

    const inProgress =
      guesses && guesses.length > 0
        ? {
            gameId,
            gameDate: game.date ?? "",
            guesses: guesses.map((g) => ({
              text: g.guess_text,
              correct: g.correct ?? false,
              correctArtist: g.correct_artist ?? false,
              correctAlbum: g.correct_album ?? false,
              attemptNumber: g.attempt_number,
            })),
            phase: "playing" as const,
          }
        : null;

    return NextResponse.json({
      gameId,
      played: false,
      won: false,
      score: null,
      title: "",
      artist_name: "",
      cover_url: "",
      inProgress,
    });
  } catch (err) {
    console.error("api/home/day/[gameId]/status error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
