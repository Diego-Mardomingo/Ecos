import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Búsqueda fuzzy en ecos_songs por title y artist_name.
 * Usa Full Text Search (spanish). Solo canciones activas y verificadas.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const limit = Math.min(Number(searchParams.get("limit")) || 10, 20);

  if (!q || q.length < 2) {
    return NextResponse.json({ data: [] });
  }

  const supabase = await createClient();

  // FTS: to_tsquery con plainto_tsquery para tolerar variaciones
  const safeQ = q.replace(/"/g, "");
  const pattern = `%${safeQ}%`;

  const { data } = await supabase
    .from("ecos_songs")
    .select("id, title, artist_name, album_title, cover_url, spotify_id")
    .eq("is_active", true)
    .or("youtube_id.not.is.null,preview_url.not.is.null")
    .or(`title.ilike."${pattern}",artist_name.ilike."${pattern}"`)
    .limit(limit);

  return NextResponse.json({ data: data ?? [] });
}
