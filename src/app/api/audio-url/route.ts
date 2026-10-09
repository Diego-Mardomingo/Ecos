import { NextRequest, NextResponse } from "next/server";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { getGameAudioCached } from "@/lib/audio/gameAudio";
import type { AudioUrlResponse } from "@/lib/audio/audioSources";
import { handleRoute, isUuid, jsonError } from "@/lib/api/route";

/**
 * Resolvedor de audio: devuelve la(s) URL(s) del MP3 de una partida para que el navegador lo
 * descargue directo del CDN. Sustituye al proxy de `/api/audio-proxy`, que se mantiene mientras el
 * reproductor antiguo siga en uso.
 *
 * Solo acepta un `gameId` y solo de un día que ya haya llegado en Madrid: el selector crea los
 * juegos con dos días de antelación y, como esto va con service role, la RLS de `ecos_games` no lo
 * cubre (auditoría oct. 2026, SEC-06 / B4-05). Un juego futuro responde igual que uno inexistente,
 * y esa comparación va fuera de la caché, en cada petición.
 *
 * Que la URL del CDN llegue al cliente no es una fuga nueva: ya viaja en el payload de `/play`.
 * El MP3 sale del CDN con su propia caché (ETag, `max-age` de una semana).
 *
 * Caché:
 * - `gameId → (fecha, preview_url)` en la caché de servidor (`getGameAudioCached`).
 * - La respuesta va `private, max-age=86400`: con Spotify la URL es permanente. Una fuente con
 *   URL firmada (Deezer) bajará ese `max-age` por debajo de lo que le quede de vida.
 * - Los errores, `no-store`.
 */

const SUCCESS_CACHE_CONTROL = "private, max-age=86400";

export const GET = handleRoute("[ops] api/audio-url", async (request: NextRequest) => {
  const gameId = request.nextUrl.searchParams.get("gameId");

  if (!gameId) return jsonError(400, "Missing gameId");
  if (!isUuid(gameId)) return jsonError(404, "Game not found");

  const audio = await getGameAudioCached(gameId);

  if (!audio || audio.date > getEffectiveGameDate()) {
    return jsonError(404, "Game not found");
  }

  if (!audio.previewUrl) {
    console.error(`[ops] audio-url: el juego ${gameId} no tiene preview_url`);
    return jsonError(404, "No preview available");
  }

  const body: AudioUrlResponse = {
    sources: [{ source: "spotify", url: audio.previewUrl, expiresAt: null }],
  };
  return NextResponse.json(body, { headers: { "Cache-Control": SUCCESS_CACHE_CONTROL } });
});
