import { NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/api/body-limit";
import { getRequestUser, handleRoute, jsonError } from "@/lib/api/route";
import { applyMove, loadRun } from "@/lib/categories/runs";
import { moveResponse } from "@/lib/categories/route-helpers";
import type { GuessMatchSong } from "@/lib/guess-match";

const GuessSchema = z.object({
  runId: z.string().uuid(),
  /** Canción de la partida a la que va la jugada (`run.roundNumber`): descarta reintentos viejos. */
  roundNumber: z.number().int().min(1),
  attemptNumber: z.number().int().min(1).max(6),
  guessText: z.string().min(1).max(500),
  /** Canción elegida en el buscador: la regla de acierto (`evaluateGuess`) compara con ella. */
  songId: z.string().uuid(),
});

/**
 * Intento en una partida por categorías. Misma evaluación que `/api/validate-guess`
 * (`evaluateGuess`). El servidor decide el intento: si `roundNumber` o `attemptNumber` no son los actuales de la
 * partida, 409 con su estado. Respuesta: `{ run, evaluation }`; si la jugada resuelve la canción,
 * `run.lastRound` la revela (y solo entonces).
 */
export const POST = handleRoute("api/category-run/guess", async (request: NextRequest) => {
  const { user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = GuessSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(400, "Invalid payload");

  const { runId, roundNumber, attemptNumber, guessText, songId } = parsed.data;
  const svc = createServiceClient();

  const [run, guessSongResult] = await Promise.all([
    loadRun(svc, user.id, runId),
    svc
      .from("ecos_songs")
      .select("id, title, artist_name, album_title")
      .eq("id", songId)
      .maybeSingle(),
  ]);

  if (!run) return jsonError(404, "Run not found");
  if (guessSongResult.error) throw guessSongResult.error;
  // El buscador solo ofrece canciones del catálogo: un id que no existe no es una respuesta.
  if (!guessSongResult.data) return jsonError(400, "Invalid payload");

  const result = await applyMove(svc, run, {
    kind: "guess",
    roundNumber,
    attemptNumber,
    guessText,
    guessSong: guessSongResult.data as GuessMatchSong,
  });
  return moveResponse(result, true);
});
