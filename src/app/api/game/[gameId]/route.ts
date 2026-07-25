import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGameById } from "@/lib/queries/games";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveGameDate } from "@/lib/date-utils";

const GameIdSchema = z.string().uuid();

/**
 * Devuelve un juego con su canción completa (incluidos `title` y `artist_name`).
 *
 * El payload va completo a propósito: `GameClient` compara los intentos en local. Pero eso
 * convertía este endpoint en un oráculo público de la respuesta del día, porque el gameId se
 * puede sacar de la home. Por eso ahora exige sesión y no sirve juegos sin publicar.
 *
 * Los invitados no lo usan: reciben el juego en el payload del Server Component de `/play`.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;

    const parsedId = GameIdSchema.safeParse(gameId);
    if (!parsedId.success) {
      return NextResponse.json({ error: "Missing gameId" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const game = await getGameById(parsedId.data);

    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    // scripts/select-daily-game.py pre-crea el juego del día siguiente: no debe ser consultable.
    if (game.date > getEffectiveGameDate()) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    return NextResponse.json(game);
  } catch (err) {
    console.error("api/game/[gameId] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
