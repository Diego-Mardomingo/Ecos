import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { repairOrphanScoreIfNeeded } from "@/lib/ecos-finalize-helpers";

/**
 * GET /api/game-progress/[gameId]
 * Returns saved progress for a game (guesses + score) for the current user.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const privateCacheHeaders = {
    "Cache-Control": "private, max-age=15, stale-while-revalidate=30",
  } as const;

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

    const [guessesResult, scoreResult, gameResult] = await Promise.all([
      supabase
        .from("ecos_guesses")
        .select("guess_text, correct, correct_artist, correct_album, attempt_number")
        .eq("user_id", user.id)
        .eq("game_id", gameId)
        .order("attempt_number", { ascending: true }),
      supabase
        .from("ecos_scores")
        .select("points, guesses_used, correct")
        .eq("user_id", user.id)
        .eq("game_id", gameId)
        .maybeSingle(),
      supabase
        .from("ecos_games")
        .select("date, ecos_songs(title, artist_name, cover_url)")
        .eq("id", gameId)
        .single(),
    ]);

    const guesses = guessesResult.data;
    let score = scoreResult.data;
    const game = gameResult.data;

    if (!score && (guesses?.length ?? 0) > 0) {
      const svc = createServiceClient();
      const repaired = await repairOrphanScoreIfNeeded(svc, user.id, gameId, {
        gameDate: game?.date ?? "",
        guesses: guesses ?? [],
      });
      if (repaired) {
        revalidateTag("games", "max");
        const { data: s2 } = await svc
          .from("ecos_scores")
          .select("points, guesses_used, correct")
          .eq("user_id", user.id)
          .eq("game_id", gameId)
          .maybeSingle();
        score = s2;
      }
    }

    const songRaw = game?.ecos_songs as unknown;
    const song =
      songRaw && typeof songRaw === "object" && !Array.isArray(songRaw)
        ? (songRaw as { title: string; artist_name: string; cover_url: string })
        : null;

    const mappedGuesses = (guesses ?? []).map((g) => ({
      text: g.guess_text,
      correct: g.correct,
      correctArtist: g.correct_artist ?? false,
      correctAlbum: g.correct_album ?? false,
      attemptNumber: g.attempt_number,
    }));

    if (!score) {
      if (mappedGuesses.length === 0) {
        return NextResponse.json({ progress: null }, { headers: privateCacheHeaders });
      }
      return NextResponse.json({
        progress: {
          gameId,
          gameDate: game?.date ?? "",
          played: false,
          won: false,
          score: null,
          guesses: mappedGuesses,
          phase: "playing" as const,
        },
      }, { headers: privateCacheHeaders });
    }

    const progress = {
      gameId,
      gameDate: game?.date ?? "",
      played: true,
      won: score.correct,
      score: score.points,
      title: song?.title,
      artist_name: song?.artist_name,
      cover_url: song?.cover_url,
      guesses: mappedGuesses,
      phase: score.correct ? ("won" as const) : ("lost" as const),
      correctAttempt: score.correct ? score.guesses_used : undefined,
    };

    return NextResponse.json({ progress }, { headers: privateCacheHeaders });
  } catch (err) {
    console.error("game-progress error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}