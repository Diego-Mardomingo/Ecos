import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { loadPlayableGame, submitAttempt } from "@/lib/ecos-finalize-helpers";
import { readJsonBody } from "@/lib/api/body-limit";
import { SKIPPED_GUESS_TEXT } from "@/lib/server-attempt";
import { z } from "zod";

const SkipSchema = z.object({
  gameId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(6),
});

/** Un salto es un intento fallido sin respuesta: ni título, ni artista, ni álbum. */
const SKIP_EVALUATION = { correct: false, correctArtist: false, correctAlbum: false };

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const parsed = SkipSchema.safeParse(body.data);

    const supabase = await createClient();
    const serviceSupabase = createServiceClient();

    const [
      {
        data: { user },
      },
      gameResult,
    ] = await Promise.all([
      supabase.auth.getUser(),
      parsed.success ? loadPlayableGame(serviceSupabase, parsed.data.gameId) : null,
    ]);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!parsed.success || !gameResult) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    if (!gameResult.ok) {
      return NextResponse.json({ error: gameResult.error }, { status: gameResult.status });
    }

    const outcome = await submitAttempt(serviceSupabase, {
      userId: user.id,
      gameId: parsed.data.gameId,
      gameDate: gameResult.game.date,
      clientAttempt: parsed.data.attemptNumber,
      guessText: SKIPPED_GUESS_TEXT,
      evaluation: SKIP_EVALUATION,
    });

    switch (outcome.kind) {
      case "error":
        console.error("skip-attempt:", outcome.message, outcome.cause);
        return NextResponse.json({ error: outcome.message }, { status: 500 });

      // Ya cerrada: idempotente, sin añadir filas ni repuntuar (un error revertiría el estado en
      // el cliente).
      case "already-finalized":
        return NextResponse.json({
          ok: true,
          attemptNumber: outcome.attemptNumber,
          alreadyFinalized: true,
        });

      case "recorded":
        return NextResponse.json({ ok: true, attemptNumber: outcome.attemptNumber });

      case "finalized":
        return NextResponse.json({ ok: true, attemptNumber: outcome.attemptNumber });
    }
  } catch (err) {
    console.error("skip-attempt error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
