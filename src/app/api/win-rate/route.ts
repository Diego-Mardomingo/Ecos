import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Devuelve el % de aciertos de un juego. Público (no requiere auth).
 * Usa service_role para poder contar todos los scores (RLS bloquea anon).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId");
    if (!gameId) {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const [{ count: totalCount }, { count: winsCount }] = await Promise.all([
      supabase
        .from("ecos_scores")
        .select("*", { count: "exact", head: true })
        .eq("game_id", gameId),
      supabase
        .from("ecos_scores")
        .select("*", { count: "exact", head: true })
        .eq("game_id", gameId)
        .eq("correct", true),
    ]);

    const t = totalCount ?? 0;
    const w = winsCount ?? 0;

    return NextResponse.json({
      winRate: t > 0 ? Math.round((w / t) * 100) : null,
      total: t,
    });
  } catch (err) {
    console.error("api/win-rate error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
