import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { artistsMatch, normalizeForCompare } from "@/lib/artist-match";
import { computeFinalizeParams } from "@/lib/ecos-finalize-helpers";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { resolveServerAttempt, MAX_ATTEMPTS } from "@/lib/server-attempt";
import { z } from "zod";

const GuessSchema = z.object({
  gameId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  attemptNumber: z.number().int().min(1).max(6),
  guessText: z.string().min(1).max(500),
  songId: z.string().uuid(),
  guessArtistName: z.string().optional(),
  guessAlbumTitle: z.string().optional(),
  finalize: z.boolean().optional(),
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
    const parsed = GuessSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { gameId, userId, attemptNumber, guessText, songId, guessArtistName, guessAlbumTitle, finalize } =
      parsed.data;

    if (userId && userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const serviceSupabase = createServiceClient();

    const { data: game, error: gameError } = await serviceSupabase
      .from("ecos_games")
      .select("id, date, ecos_songs(id, title, artist_name, album_title)")
      .eq("id", gameId)
      .single();

    if (gameError || !game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    const song = (game.ecos_songs as unknown) as {
      id: string;
      title: string;
      artist_name: string;
      album_title: string | null;
    } | null;

    if (!song) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 });
    }

    const gameDate = (game as { date?: string }).date ?? "";

    // select-daily-game.py pre-crea el juego del día siguiente: no se puede jugar por adelantado.
    if (gameDate > getEffectiveGameDate()) {
      return NextResponse.json({ error: "Game not available" }, { status: 403 });
    }

    const [{ data: existingScore }, { data: existingGuesses }] = await Promise.all([
      serviceSupabase
        .from("ecos_scores")
        .select("points, guesses_used, correct")
        .eq("user_id", user.id)
        .eq("game_id", gameId)
        .maybeSingle(),
      serviceSupabase
        .from("ecos_guesses")
        .select("attempt_number, guess_text")
        .eq("user_id", user.id)
        .eq("game_id", gameId),
    ]);

    const serverAttempt = resolveServerAttempt(
      existingGuesses ?? [],
      attemptNumber,
      guessText
    );

    const isCorrect =
      songId === song.id ||
      normalizeForCompare(guessText).includes(normalizeForCompare(song.title));

    const correctArtist =
      guessArtistName != null && guessArtistName.trim()
        ? artistsMatch(guessArtistName, song.artist_name)
        : false;
    const correctAlbum =
      guessAlbumTitle != null && song.album_title != null
        ? normalizeForCompare(guessAlbumTitle) === normalizeForCompare(song.album_title)
        : false;

    /**
     * Partida ya cerrada: no se registra el intento ni se vuelve a puntuar (antes se podía
     * repetir la finalización para repuntuar). Se responde 200 con la puntuación guardada, no un
     * error: el cliente revierte la victoria en la UI ante cualquier fallo, y esta rama la
     * alcanza también un reintento legítimo tras un problema de red.
     */
    if (existingScore) {
      return NextResponse.json({
        correct: isCorrect,
        correctArtist,
        correctAlbum,
        attemptNumber: existingScore.guesses_used ?? serverAttempt,
        totalPoints: existingScore.points ?? 0,
        alreadyFinalized: true,
      });
    }

    const needsFinalize = !!finalize && (isCorrect || serverAttempt >= MAX_ATTEMPTS);

    if (!needsFinalize) {
      const { error: upsertError } = await serviceSupabase.from("ecos_guesses").upsert(
        {
          user_id: user.id,
          game_id: gameId,
          attempt_number: serverAttempt,
          guess_text: guessText,
          correct: isCorrect,
          correct_artist: correctArtist,
          correct_album: correctAlbum,
        },
        { onConflict: "user_id,game_id,attempt_number" }
      );

      if (upsertError) {
        console.error("validate-guess upsert error:", upsertError);
        return NextResponse.json({ error: "Failed to save guess" }, { status: 500 });
      }

      if (!finalize) {
        return NextResponse.json({
          correct: isCorrect,
          correctArtist,
          correctAlbum,
          attemptNumber: serverAttempt,
        });
      }

      return NextResponse.json({ correct: false, attemptNumber: serverAttempt });
    }

    const { data: leaderboard } = await serviceSupabase
      .from("ecos_leaderboard")
      .select("streak, last_played")
      .eq("user_id", user.id)
      .single();

    const { newStreak, updateStreak, scoreResult } = computeFinalizeParams({
      gameDate,
      isCorrect,
      attemptNumber: serverAttempt,
      leaderboard: leaderboard ?? null,
    });

    const { error: finalizeError } = await serviceSupabase.rpc("ecos_guess_and_finalize_score", {
      p_user_id: user.id,
      p_game_id: gameId,
      p_attempt_number: serverAttempt,
      p_guess_text: guessText,
      p_correct: isCorrect,
      p_correct_artist: correctArtist,
      p_correct_album: correctAlbum,
      p_points: scoreResult.totalPoints,
      p_guesses_used: serverAttempt,
      p_won: isCorrect,
      p_streak: newStreak,
      p_update_streak: updateStreak,
    });

    if (finalizeError) {
      console.error("ecos_guess_and_finalize_score:", finalizeError);
      return NextResponse.json({ error: "Failed to save score" }, { status: 500 });
    }

    revalidateTag("games", "max");

    return NextResponse.json({
      correct: isCorrect,
      correctArtist,
      correctAlbum,
      attemptNumber: serverAttempt,
      ...scoreResult,
    });
  } catch (err) {
    console.error("validate-guess error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}