import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "@/lib/queries/public-client";
import { handleRoute, jsonError, publicCacheHeaders } from "@/lib/api/route";

/** Resultados por búsqueda. Fijo: el único consumidor (`useSearchSongs`) nunca pidió otro. */
const SEARCH_LIMIT = 100;

/** Columnas que necesita el buscador; nada de `preview_url` ni del resto de la fila. */
const SEARCH_COLUMNS = "id, title, artist_name, album_title, cover_url, spotify_id";

/**
 * El catálogo cambia una vez por semana (ingesta) y la respuesta es igual para todos: 1 h en la
 * CDN y hasta un día sirviendo la anterior mientras se refresca.
 */
const SEARCH_CACHE = publicCacheHeaders(3600, 86400);

/** Normaliza el término de búsqueda: trim, colapsar espacios, quitar comillas. */
function normalizeSearchQuery(q: string): string {
  return q
    .trim()
    .replace(/\s+/g, " ")
    .replace(/"/g, "");
}

interface SearchRow {
  id: string;
  title: string;
  artist_name: string;
  album_title: string | null;
  cover_url: string | null;
  spotify_id: string | null;
}

/**
 * Búsqueda en ecos_songs por title y artist_name.
 * Insensible a acentos (vía unaccent en DB). Solo canciones activas y con preview, ordenadas por
 * relevancia (ver `ecos_search_songs` en supabase/schema/02_functions.sql).
 *
 * Con el cliente anónimo y sin cookies: la respuesta va a la CDN y no puede llevar `Set-Cookie`.
 */
export const GET = handleRoute("api/search-songs", async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const rawQ = searchParams.get("q");
  const q = rawQ ? normalizeSearchQuery(rawQ) : "";

  if (!q || q.length < 2) {
    return NextResponse.json({ data: [] }, { headers: SEARCH_CACHE });
  }

  const { data, error } = await createPublicClient()
    .rpc("ecos_search_songs", { p_query: q, p_limit: SEARCH_LIMIT })
    .select(SEARCH_COLUMNS);

  if (error) {
    // Antes se devolvía `[]` y un fallo parecía «sin resultados». Un 500 no se cachea y el
    // cliente lo puede reintentar.
    console.error("[ops] api/search-songs:", error.code, error.message);
    return jsonError(500, "Internal server error");
  }

  const rows = (data ?? []) as unknown as SearchRow[];
  return NextResponse.json(
    {
      data: rows.map((r) => ({
        id: r.id,
        title: r.title,
        artist_name: r.artist_name,
        album_title: r.album_title,
        cover_url: r.cover_url,
        spotify_id: r.spotify_id,
      })),
    },
    { headers: SEARCH_CACHE }
  );
});
