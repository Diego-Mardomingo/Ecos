import { NextRequest, NextResponse } from "next/server";
import {
  GUESS_COLUMNS,
  getGameByIdCached,
  isFutureGame,
  toInProgress,
  type GuessRow,
} from "@/lib/queries/games";
import {
  getRequestUser,
  handleRoute,
  isUuid,
  jsonError,
  PRIVATE_NO_STORE,
} from "@/lib/api/route";

type Params = { params: Promise<{ gameId: string }> };

const notPlayed = (gameId: string) => ({
  gameId,
  played: false,
  won: false,
  score: null,
  title: "",
  artist_name: "",
  cover_url: "",
  inProgress: null,
});

/**
 * Estado de un día para la home: jugado (con la canción), a medias (con los intentos) o sin jugar.
 * La canción solo sale si el usuario tiene puntuación en ese juego.
 */
export const GET = handleRoute(
  "api/home/day/[gameId]/status",
  async (_request: NextRequest, { params }: Params) => {
    const { gameId } = await params;
    if (!gameId) return jsonError(400, "Missing gameId");
    if (!isUuid(gameId)) return jsonError(404, "Game not found");

    // El juego (de la caché de servidor) no depende de la sesión: van a la vez.
    const [{ supabase, user }, game] = await Promise.all([
      getRequestUser(),
      getGameByIdCached(gameId),
    ]);

    // Un juego futuro no existe para nadie (es lo que ya hacía la RLS de ecos_games).
    if (!game || isFutureGame(game)) return jsonError(404, "Game not found");

    if (!user) return NextResponse.json(notPlayed(gameId), { headers: PRIVATE_NO_STORE });

    const [scoreRes, guessesRes] = await Promise.all([
      supabase
        .from("ecos_scores")
        .select("points, correct")
        .eq("user_id", user.id)
        .eq("game_id", gameId)
        .maybeSingle(),
      supabase
        .from("ecos_guesses")
        .select(GUESS_COLUMNS)
        .eq("user_id", user.id)
        .eq("game_id", gameId)
        .order("attempt_number", { ascending: true }),
    ]);
    if (scoreRes.error) throw scoreRes.error;
    if (guessesRes.error) throw guessesRes.error;

    const scoreRow = scoreRes.data;
    if (scoreRow) {
      const song = game.ecos_songs;
      return NextResponse.json(
        {
          gameId,
          played: true,
          won: scoreRow.correct === true,
          score: scoreRow.points ?? null,
          title: song.title ?? "",
          artist_name: song.artist_name ?? "",
          cover_url: song.cover_url ?? "",
          inProgress: null,
        },
        { headers: PRIVATE_NO_STORE }
      );
    }

    return NextResponse.json(
      {
        ...notPlayed(gameId),
        inProgress: toInProgress(gameId, game.date ?? "", (guessesRes.data ?? []) as GuessRow[]),
      },
      { headers: PRIVATE_NO_STORE }
    );
  }
);
