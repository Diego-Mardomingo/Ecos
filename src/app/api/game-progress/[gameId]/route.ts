import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { repairOrphanScoreIfNeeded } from "@/lib/ecos-finalize-helpers";
import {
  GUESS_COLUMNS,
  getGameByIdCached,
  isFutureGame,
  mapGuessRow,
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

/**
 * GET /api/game-progress/[gameId]
 * Progreso guardado del usuario en un juego (intentos y puntuación).
 *
 * `private, no-store`: cambia con cada jugada y el cliente siempre lo pide sin caché. Antes
 * mandaba `max-age=15`, que habría servido progreso viejo tras un intento a quien no pidiera con
 * `no-store`.
 */
export const GET = handleRoute(
  "game-progress",
  async (_request: NextRequest, { params }: Params) => {
    const { gameId } = await params;
    if (!gameId) return jsonError(400, "Missing gameId");
    // El cliente trata el 404 como «sin progreso».
    if (!isUuid(gameId)) return jsonError(404, "Game not found");

    const [{ supabase, user }, game] = await Promise.all([
      getRequestUser(),
      getGameByIdCached(gameId),
    ]);

    if (!user) return jsonError(401, "Unauthorized");
    if (!game || isFutureGame(game)) return jsonError(404, "Game not found");

    const [guessesResult, scoreResult] = await Promise.all([
      supabase
        .from("ecos_guesses")
        .select(GUESS_COLUMNS)
        .eq("user_id", user.id)
        .eq("game_id", gameId)
        .order("attempt_number", { ascending: true }),
      supabase
        .from("ecos_scores")
        .select("points, guesses_used, correct")
        .eq("user_id", user.id)
        .eq("game_id", gameId)
        .maybeSingle(),
    ]);
    if (guessesResult.error) throw guessesResult.error;
    if (scoreResult.error) throw scoreResult.error;

    const guesses = (guessesResult.data ?? []) as GuessRow[];
    let score = scoreResult.data;

    // Partida decidida en ecos_guesses pero sin puntuación: se cierra aquí (service role; la
    // sesión ya está comprobada arriba).
    if (!score && guesses.length > 0) {
      const svc = createServiceClient();
      const repaired = await repairOrphanScoreIfNeeded(svc, user.id, gameId, {
        gameDate: game.date,
        guesses: guesses.map((g) => ({
          correct: g.correct === true,
          attempt_number: g.attempt_number,
        })),
      });
      if (repaired) {
        const { data: s2 } = await svc
          .from("ecos_scores")
          .select("points, guesses_used, correct")
          .eq("user_id", user.id)
          .eq("game_id", gameId)
          .maybeSingle();
        score = s2;
      }
    }

    const mappedGuesses = guesses.map(mapGuessRow);

    if (!score) {
      if (mappedGuesses.length === 0) {
        return NextResponse.json({ progress: null }, { headers: PRIVATE_NO_STORE });
      }
      return NextResponse.json(
        {
          progress: {
            gameId,
            gameDate: game.date,
            played: false,
            won: false,
            score: null,
            guesses: mappedGuesses,
            phase: "playing" as const,
          },
        },
        { headers: PRIVATE_NO_STORE }
      );
    }

    const song = game.ecos_songs;
    const progress = {
      gameId,
      gameDate: game.date,
      played: true,
      won: score.correct,
      score: score.points,
      title: song.title,
      artist_name: song.artist_name,
      cover_url: song.cover_url,
      guesses: mappedGuesses,
      phase: score.correct ? ("won" as const) : ("lost" as const),
      correctAttempt: score.correct ? score.guesses_used : undefined,
    };

    return NextResponse.json({ progress }, { headers: PRIVATE_NO_STORE });
  }
);
