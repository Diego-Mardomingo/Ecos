import { NextRequest, NextResponse } from "next/server";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { getGameAudioCached, type GameAudio } from "@/lib/audio/gameAudio";
import { resolveDeezerPreview } from "@/lib/audio/deezer";
import type { AudioSource, AudioUrlResponse } from "@/lib/audio/audioSources";
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

const SPOTIFY_CACHE_CONTROL = "private, max-age=86400";
const DEEZER_MAX_AGE_SECONDS = 600;
/** Margen que se descuenta a la vida de la URL firmada para que el cliente no la use al límite. */
const DEEZER_SAFETY_SECONDS = 180;
/** Respuesta degradada (Deezer era la primaria y ha fallado): se reintenta pronto, no en un día. */
const DEGRADED_CACHE_CONTROL = "private, max-age=60";

function spotifySource(audio: GameAudio): AudioSource[] {
  return audio.previewUrl ? [{ source: "spotify", url: audio.previewUrl, expiresAt: null }] : [];
}

async function deezerSource(audio: GameAudio, gameId: string): Promise<AudioSource[]> {
  if (!audio.deezerId) return [];
  const result = await resolveDeezerPreview(audio.deezerId);
  if (result.ok) return [result.source];
  console.error(`[ops] audio-url: Deezer no sirvió el juego ${gameId} (${result.reason})`);
  return [];
}

async function resolveSources(audio: GameAudio, gameId: string): Promise<AudioSource[]> {
  if (audio.audioSource === "deezer") {
    return [...(await deezerSource(audio, gameId)), ...spotifySource(audio)];
  }
  const spotify = spotifySource(audio);
  return spotify.length > 0 ? spotify : deezerSource(audio, gameId);
}

function cacheControlFor(sources: AudioSource[]): string {
  let maxAge = Infinity;
  for (const { expiresAt } of sources) {
    if (expiresAt === null) continue;
    const left = Math.floor((expiresAt - Date.now()) / 1000) - DEEZER_SAFETY_SECONDS;
    maxAge = Math.min(maxAge, DEEZER_MAX_AGE_SECONDS, left);
  }
  if (maxAge === Infinity) return SPOTIFY_CACHE_CONTROL;
  return maxAge > 0 ? `private, max-age=${maxAge}` : "no-store";
}

export const GET = handleRoute("[ops] api/audio-url", async (request: NextRequest) => {
  const gameId = request.nextUrl.searchParams.get("gameId");

  if (!gameId) return jsonError(400, "Missing gameId");
  if (!isUuid(gameId)) return jsonError(404, "Game not found");

  const audio = await getGameAudioCached(gameId);

  if (!audio || audio.date > getEffectiveGameDate()) {
    return jsonError(404, "Game not found");
  }

  const sources = await resolveSources(audio, gameId);
  if (sources.length === 0) {
    console.error(`[ops] audio-url: el juego ${gameId} no tiene audio`);
    return jsonError(404, "No preview available");
  }

  const body: AudioUrlResponse = { sources };
  const degraded = audio.audioSource === "deezer" && !sources.some((s) => s.source === "deezer");
  const cacheControl = degraded ? DEGRADED_CACHE_CONTROL : cacheControlFor(sources);
  return NextResponse.json(body, { headers: { "Cache-Control": cacheControl } });
});
