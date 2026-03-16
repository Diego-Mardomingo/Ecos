import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { calculateScore } from "@/lib/scoring";
import { artistsMatch, normalizeForCompare } from "@/lib/artist-match";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { z } from "zod";

const GuessSchema = z.object({
  gameId: z.string().uuid(),
  userId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(6),
  guessText: z.string().min(1).max(500),
  songId: z.string().uuid(),
  guessArtistName: z.string().optional(),
  guessAlbumTitle: z.string().optional(),
  finalize: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = GuessSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { gameId, userId, attemptNumber, guessText, songId, guessArtistName, guessAlbumTitle, finalize } =
      parsed.data;

    const supabase = await createServiceClient();

    const { data: game, error: gameError } = await supabase
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

    await supabase.from("ecos_guesses").upsert({
      user_id: userId,
      game_id: gameId,
      attempt_number: attemptNumber,
      guess_text: guessText,
      correct: isCorrect,
      correct_artist: correctArtist,
      correct_album: correctAlbum,
    });

    if (!finalize) {
      return NextResponse.json({
        correct: isCorrect,
        correctArtist,
        correctAlbum,
      });
    }

    if (!isCorrect && attemptNumber < 6) {
      return NextResponse.json({ correct: false });
    }

    const gameDate = (game as { date?: string }).date ?? "";
    const todayMadrid = getEffectiveGameDate();
    const isTodaysGame = gameDate === todayMadrid;

    const { data: leaderboard } = await supabase
      .from("ecos_leaderboard")
      .select("streak, last_played")
      .eq("user_id", userId)
      .single();

    let newStreak: number;
    let updateStreak = isTodaysGame;

    if (isTodaysGame) {
      if (isCorrect) {
        const lastPlayed = leaderboard?.last_played as string | null | undefined;
        const [y, m, d] = todayMadrid.split("-").map(Number);
        const yesterdayDate = new Date(Date.UTC(y, m - 1, d - 1));
        const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);
        const lastPlayedContinuation =
          lastPlayed && (lastPlayed === yesterdayStr || lastPlayed === todayMadrid);
        newStreak = lastPlayedContinuation
          ? (leaderboard?.streak ?? 0) + 1
          : 1;
      } else {
        newStreak = 0;
      }
    } else {
      newStreak = leaderboard?.streak ?? 0;
    }

    const scoreResult = isCorrect
      ? calculateScore(attemptNumber, newStreak)
      : { basePoints: 0, streakBonus: 0, totalPoints: 0 };

    await supabase.from("ecos_scores").upsert({
      user_id: userId,
      game_id: gameId,
      points: scoreResult.totalPoints,
      guesses_used: attemptNumber,
      correct: isCorrect,
    });

    await supabase.rpc("ecos_update_leaderboard", {
      p_user_id: userId,
      p_points: scoreResult.totalPoints,
      p_won: isCorrect,
      p_streak: newStreak,
      p_update_streak: updateStreak,
    });

    revalidateTag("games", "max");

    return NextResponse.json({
      correct: isCorrect,
      correctArtist,
      correctAlbum,
      ...scoreResult,
    });
  } catch (err) {
    console.error("validate-guess error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
