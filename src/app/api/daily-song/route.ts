import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { unwrapToOne } from "@/lib/supabase/relations";
import { getEffectiveGameDate } from "@/lib/date-utils";

/**
 * Metadatos mínimos del reto de hoy.
 *
 * NOTA: ningún componente de la app lo usa (el juego llega por el Server Component de `/play`).
 * Se mantiene como endpoint público, así que aquí no puede salir nada que revele la canción:
 * ni título, ni artista, ni carátula, ni `youtube_id` (buscable), ni `preview_url` (la URL cruda
 * del CDN que `/api/audio-proxy` existe precisamente para ocultar).
 */
export async function GET() {
  const supabase = await createClient();
  const effectiveDate = getEffectiveGameDate();

  const { data, error } = await supabase
    .from("ecos_games")
    .select("id, date, game_number, ecos_songs ( id )")
    .eq("date", effectiveDate)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "No game today" }, { status: 404 });
  }

  const { ecos_songs, ...gameData } = data;
  const song = unwrapToOne<{ id: string }>(ecos_songs);

  return NextResponse.json({
    ...gameData,
    song: song ? { id: song.id } : null,
  });
}
