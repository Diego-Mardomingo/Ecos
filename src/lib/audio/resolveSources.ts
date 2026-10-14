import { resolveDeezerPreview } from "@/lib/audio/deezer";
import type { AudioSource } from "@/lib/audio/audioSources";
import type { GameAudio } from "@/lib/audio/gameAudio";
// Solo servidor (llama a la API de Deezer).

/**
 * Resolución de las fuentes de audio de una canción, común a `/api/audio-url` (juego diario) y a
 * `/api/category-run/audio` (modo por categorías). Las URL firmadas de Deezer se piden al vuelo y
 * no se guardan ni pasan por `unstable_cache` (ver `deezer.ts`).
 *
 * Fuentes, por orden de preferencia (la primaria la fija quien llama en `audioSource`):
 * - `deezer`: `[deezer, spotify]`. Si Deezer falla, `[spotify]` (y se registra).
 * - `spotify`: `[spotify]`; solo si no hay `preview_url` y la canción tiene `deezer_id`, `[deezer]`.
 *   Con Spotify de por medio no se llama a Deezer: los juegos viejos no gastan cuota.
 *
 * `label` es lo que sale en el log para identificar el caso (un id de juego o de partida, nunca
 * título ni artista).
 */

const SPOTIFY_CACHE_CONTROL = "private, max-age=86400";
const DEEZER_MAX_AGE_SECONDS = 600;
/** Margen que se descuenta a la vida de la URL firmada para que el cliente no la use al límite. */
const DEEZER_SAFETY_SECONDS = 180;
/** Respuesta degradada (Deezer era la primaria y ha fallado): se reintenta pronto, no en un día. */
const DEGRADED_CACHE_CONTROL = "private, max-age=60";

/** Duración mínima (s) de una preview de Deezer para que sea la fuente primaria (`MIN_PREVIEW_SECONDS`). */
const MIN_PREVIEW_SECONDS = 29;

/** Datos de audio de una canción; la fecha del juego no interviene en la resolución. */
export type SongAudio = Omit<GameAudio, "date">;

function spotifySource(audio: SongAudio): AudioSource[] {
  return audio.previewUrl ? [{ source: "spotify", url: audio.previewUrl, expiresAt: null }] : [];
}

async function deezerSource(audio: SongAudio, label: string): Promise<AudioSource[]> {
  if (!audio.deezerId) return [];
  const result = await resolveDeezerPreview(audio.deezerId);
  if (result.ok) return [result.source];
  console.error(`[ops] audio: Deezer no sirvió ${label} (${result.reason})`);
  return [];
}

export async function resolveAudioSources(
  audio: SongAudio,
  label: string
): Promise<AudioSource[]> {
  if (audio.audioSource === "deezer") {
    return [...(await deezerSource(audio, label)), ...spotifySource(audio)];
  }
  const spotify = spotifySource(audio);
  return spotify.length > 0 ? spotify : deezerSource(audio, label);
}

/**
 * `Cache-Control` de una respuesta con estas fuentes: solo Spotify, un día; con Deezer, lo que le
 * quede de vida a la URL menos un margen (tope 10 min) o `no-store`; si Deezer era la primaria y
 * ha fallado, un minuto para reintentarlo pronto.
 */
export function audioCacheControl(audio: SongAudio, sources: AudioSource[]): string {
  const degraded = audio.audioSource === "deezer" && !sources.some((s) => s.source === "deezer");
  if (degraded) return DEGRADED_CACHE_CONTROL;

  let maxAge = Infinity;
  for (const { expiresAt } of sources) {
    if (expiresAt === null) continue;
    const left = Math.floor((expiresAt - Date.now()) / 1000) - DEEZER_SAFETY_SECONDS;
    maxAge = Math.min(maxAge, DEEZER_MAX_AGE_SECONDS, left);
  }
  if (maxAge === Infinity) return SPOTIFY_CACHE_CONTROL;
  return maxAge > 0 ? `private, max-age=${maxAge}` : "no-store";
}

/**
 * Fuente primaria de una canción suelta (las partidas por categoría no fijan una): Deezer si tiene
 * `deezer_id` y la preview mide al menos `MIN_PREVIEW_SECONDS`; si no, Spotify. Mismo criterio que
 * `audio_source_for` de `scripts/selection.py`.
 */
export function preferredAudioSource(song: {
  deezer_id: number | null;
  deezer_preview_seconds: number | null;
}): "deezer" | "spotify" {
  return song.deezer_id && (song.deezer_preview_seconds ?? 0) >= MIN_PREVIEW_SECONDS
    ? "deezer"
    : "spotify";
}
