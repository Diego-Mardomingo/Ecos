import { NextRequest, NextResponse } from "next/server";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { getGameAudioCached } from "@/lib/audio/gameAudio";
import { audioCacheControl, resolveAudioSources } from "@/lib/audio/resolveSources";
import type { AudioUrlResponse } from "@/lib/audio/audioSources";
import { handleRoute, isUuid, jsonError } from "@/lib/api/route";

/**
 * Resolvedor de audio: devuelve la(s) URL(s) del MP3 de una partida para que el navegador lo
 * descargue directo del CDN. Sustituye al antiguo proxy de streaming.
 *
 * Solo acepta un `gameId` y solo de un día que ya haya llegado en Madrid: el selector crea los
 * juegos con dos días de antelación y, como esto va con service role, la RLS de `ecos_games` no lo
 * cubre (auditoría oct. 2026, SEC-06 / B4-05). Un juego futuro responde igual que uno inexistente,
 * y esa comparación va fuera de la caché, en cada petición.
 *
 * Que la URL del CDN llegue al cliente no es una fuga nueva: ya viaja en el payload de `/play`.
 * El MP3 sale del CDN con su propia caché (ETag, `max-age` de una semana).
 *
 * Fuentes, por orden de preferencia (la fuente primaria de cada partida es `ecos_games.audio_source`):
 * - `deezer`: `[deezer, spotify]`. Si Deezer falla, `[spotify]` (y se registra).
 * - `spotify`: `[spotify]`; solo si no hay `preview_url` y la canción tiene `deezer_id`, `[deezer]`.
 *   Con Spotify de por medio no se llama a Deezer: los juegos viejos no gastan cuota.
 *
 * Caché:
 * - `gameId → (fecha, fuente, preview_url, deezer_id)` en la caché de servidor (`getGameAudioCached`).
 *   Nunca la URL firmada de Deezer: esa vive en memoria en `deezer.ts`, con su caducidad.
 * - Solo Spotify: `private, max-age=86400` (URL permanente). Con Deezer, `max-age` es lo que le
 *   quede de vida menos 3 min (tope 10 min), o `no-store` si ya no hay margen. Si Deezer era la
 *   primaria y falló, `max-age=60` para reintentarlo pronto.
 * - Los errores, `no-store`.
 */

export const GET = handleRoute("[ops] api/audio-url", async (request: NextRequest) => {
  const gameId = request.nextUrl.searchParams.get("gameId");

  if (!gameId) return jsonError(400, "Missing gameId");
  if (!isUuid(gameId)) return jsonError(404, "Game not found");

  const audio = await getGameAudioCached(gameId);

  if (!audio || audio.date > getEffectiveGameDate()) {
    return jsonError(404, "Game not found");
  }

  const sources = await resolveAudioSources(audio, `el juego ${gameId}`);
  if (sources.length === 0) {
    console.error(`[ops] audio-url: el juego ${gameId} no tiene audio`);
    return jsonError(404, "No preview available");
  }

  const body: AudioUrlResponse = { sources };
  return NextResponse.json(body, {
    headers: { "Cache-Control": audioCacheControl(audio, sources) },
  });
});
