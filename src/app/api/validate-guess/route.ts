import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { loadPlayableGame, submitAttempt } from "@/lib/ecos-finalize-helpers";
import { evaluateGuess, type GuessMatchSong } from "@/lib/guess-match";
import { readJsonBody } from "@/lib/api/body-limit";
import { z } from "zod";

const GuessSchema = z.object({
  gameId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  attemptNumber: z.number().int().min(1).max(6),
  guessText: z.string().min(1).max(500),
  songId: z.string().uuid(),
  /**
   * Se siguen aceptando por compatibilidad con el cliente actual, pero ya no se usan: artista y
   * álbum se comparan con los de la canción `songId` leída de la BD.
   */
  guessArtistName: z.string().max(500).optional(),
  guessAlbumTitle: z.string().max(500).optional(),
  /**
   * Ignorado: el servidor cierra la partida siempre que la jugada la decide (acierto o sexto
   * intento). Ver `submitAttempt` en `src/lib/ecos-finalize-helpers.ts`.
   */
  finalize: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const parsed = GuessSchema.safeParse(body.data);

    const supabase = await createClient();
    const serviceSupabase = createServiceClient();

    // Sesión, juego y canción elegida no dependen entre sí: van en paralelo. El 401 sigue
    // saliendo antes que cualquier otra respuesta y no se lee ni escribe nada del usuario hasta
    // haber descartado un juego futuro.
    const [
      {
        data: { user },
      },
      gameResult,
      guessSongResult,
    ] = await Promise.all([
      supabase.auth.getUser(),
      parsed.success ? loadPlayableGame(serviceSupabase, parsed.data.gameId) : null,
      parsed.success
        ? serviceSupabase
            .from("ecos_songs")
            .select("id, title, artist_name, album_title")
            .eq("id", parsed.data.songId)
            .maybeSingle()
        : null,
    ]);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!parsed.success || !gameResult || !guessSongResult) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { gameId, userId, attemptNumber, guessText } = parsed.data;

    if (userId && userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!gameResult.ok) {
      return NextResponse.json({ error: gameResult.error }, { status: gameResult.status });
    }

    const { game } = gameResult;
    if (!game.song) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 });
    }

    if (guessSongResult.error) throw guessSongResult.error;
    const guessSong = guessSongResult.data as GuessMatchSong | null;
    // El buscador solo ofrece canciones del catálogo: un id que no existe no es una respuesta.
    if (!guessSong) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const evaluation = evaluateGuess(guessSong, game.song);

    const outcome = await submitAttempt(serviceSupabase, {
      userId: user.id,
      gameId,
      gameDate: game.date,
      clientAttempt: attemptNumber,
      guessText,
      evaluation,
    });

    switch (outcome.kind) {
      case "error":
        console.error("validate-guess:", outcome.message, outcome.cause);
        return NextResponse.json({ error: outcome.message }, { status: 500 });

      /**
       * Partida ya cerrada: no se registra el intento ni se vuelve a puntuar (antes se podía
       * repetir la finalización para repuntuar). Se responde 200 con la puntuación guardada, no
       * un error: el cliente revierte la victoria en la UI ante cualquier fallo, y esta rama la
       * alcanza también un reintento legítimo tras un problema de red.
       */
      case "already-finalized":
        return NextResponse.json({
          ...evaluation,
          attemptNumber: outcome.attemptNumber,
          totalPoints: outcome.totalPoints,
          alreadyFinalized: true,
        });

      case "recorded":
        return NextResponse.json({ ...evaluation, attemptNumber: outcome.attemptNumber });

      case "finalized":
        return NextResponse.json({
          ...evaluation,
          attemptNumber: outcome.attemptNumber,
          ...outcome.scoreResult,
        });
    }
  } catch (err) {
    console.error("validate-guess error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
