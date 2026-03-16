import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Normaliza el término de búsqueda: trim, colapsar espacios, quitar comillas. */
function normalizeSearchQuery(q: string): string {
  return q
    .trim()
    .replace(/\s+/g, " ")
    .replace(/"/g, "");
}

/**
 * Búsqueda en ecos_songs por title y artist_name.
 * Insensible a acentos (vía unaccent en DB). Solo canciones activas y verificadas.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawQ = searchParams.get("q");
  const q = rawQ ? normalizeSearchQuery(rawQ) : "";
  const requestedLimit = searchParams.get("limit");
  const limit = requestedLimit ? Math.min(Number(requestedLimit), 200) : 100;

  if (!q || q.length < 2) {
    return NextResponse.json({ data: [] });
  }

  const supabase = await createClient();

  const { data } = await supabase.rpc("ecos_search_songs", {
    p_query: q,
    p_limit: limit,
  });

  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    artist_name: string;
    album_title: string | null;
    cover_url: string | null;
    spotify_id: string | null;
  }>;
  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      title: r.title,
      artist_name: r.artist_name,
      album_title: r.album_title,
      cover_url: r.cover_url,
      spotify_id: r.spotify_id,
    })),
  });
}
