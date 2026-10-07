import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { unwrapToOne } from "@/lib/supabase/relations";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { isUuid } from "@/lib/api/route";

/**
 * Proxy de audio para el preview de Spotify.
 *
 * Sirve el fragmento sin exponer la URL del CDN al cliente. Solo acepta un `gameId` y solo de un
 * día que ya haya llegado en Madrid: el selector crea los juegos con dos días de antelación y,
 * como esto va con service role, la RLS de `ecos_games` no lo cubre (auditoría oct. 2026,
 * SEC-06 / B4-05). Un juego futuro responde igual que uno inexistente.
 *
 * Caché:
 * - `gameId → (fecha, preview_url)` no cambia nunca: va en la caché de servidor y la BD solo se
 *   consulta la primera vez (PERFDB-16).
 * - El MP3 tampoco cambia para un juego, así que el navegador lo guarda una semana
 *   (`private, max-age, immutable`) en vez de bajarlo entero en cada visita a la partida
 *   (COST-01 / PDATA-07). Antes iba con `no-store` «para evitar la extracción», pero el preview
 *   llega entero al navegador de todos modos. Es `private` y no `public` a propósito: las
 *   respuestas parciales (206) no deben acabar en una caché compartida que las sirva a otra
 *   petición con otro rango.
 * - Los errores, `no-store`.
 */

const AUDIO_CACHE_CONTROL = "private, max-age=604800, immutable";
const NO_STORE = "no-store";

interface GameAudio {
  date: string;
  previewUrl: string | null;
}

function getGameAudioCached(gameId: string): Promise<GameAudio | null> {
  return unstable_cache(
    async (): Promise<GameAudio | null> => {
      const { data, error } = await createServiceClient()
        .from("ecos_games")
        .select("date, ecos_songs(preview_url)")
        .eq("id", gameId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const song = unwrapToOne<{ preview_url: string | null }>(data.ecos_songs);
      return { date: data.date as string, previewUrl: song?.preview_url ?? null };
    },
    ["game-audio", gameId],
    { revalidate: 86400 }
  )();
}

function textResponse(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Cache-Control": NO_STORE },
  });
}

export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get("gameId");

  try {
    if (!gameId) return textResponse("Missing gameId", 400);
    if (!isUuid(gameId)) return textResponse("Game not found", 404);

    const audio = await getGameAudioCached(gameId);

    if (!audio || audio.date > getEffectiveGameDate()) {
      return textResponse("Game not found", 404);
    }

    if (!audio.previewUrl) {
      console.error(`[ops] audio-proxy: el juego ${gameId} no tiene preview_url`);
      return textResponse("No preview available", 404);
    }

    const range = request.headers.get("range");
    const upstream = await fetch(audio.previewUrl, {
      // Reenviar Range si el cliente lo solicita (seek y precarga parcial)
      headers: range ? { Range: range } : {},
    });

    if (upstream.status === 416) {
      // Rango fuera del fichero: se propaga tal cual para que el navegador lo corrija.
      const headers = new Headers({ "Cache-Control": NO_STORE, "Accept-Ranges": "bytes" });
      const contentRange = upstream.headers.get("Content-Range");
      if (contentRange) headers.set("Content-Range", contentRange);
      return new NextResponse(null, { status: 416, headers });
    }

    if (!upstream.ok) {
      console.error(
        `[ops] audio-proxy: el CDN respondió ${upstream.status} para el juego ${gameId}`
      );
      return textResponse("Failed to fetch audio", 502);
    }

    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
      "Cache-Control": AUDIO_CACHE_CONTROL,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    });

    // Propagar Content-Length y Content-Range si existen (necesario para seek)
    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);
    const contentRange = upstream.headers.get("Content-Range");
    if (contentRange) headers.set("Content-Range", contentRange);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    console.error(`[ops] audio-proxy error (juego ${gameId ?? "?"}):`, err);
    return textResponse("Internal server error", 500);
  }
}
