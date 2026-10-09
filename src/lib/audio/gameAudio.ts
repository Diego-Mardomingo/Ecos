import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { unwrapToOne } from "@/lib/supabase/relations";
import type { AudioSourceName } from "@/lib/audio/audioSources";

/**
 * `gameId → (fecha, fuente, preview_url, deezer_id)` en la caché de servidor, usada por
 * `/api/audio-url`. Esos datos no cambian nunca para un juego, así que la BD solo se consulta la
 * primera vez (PERFDB-16).
 *
 * Va con service role, por lo que la RLS de `ecos_games` no protege: **quien llame debe comparar
 * `date` con `getEffectiveGameDate()` en cada petición** (fuera de la caché, que guarda también
 * los juegos futuros) y responder a uno futuro igual que a uno inexistente (SEC-06 / B4-05).
 *
 * Solo vale para datos permanentes: la URL de Spotify y el id de Deezer. `unstable_cache` sirve el
 * valor caducado mientras lo refresca, así que una URL firmada con caducidad (la de Deezer, que
 * se resuelve en `deezer.ts`) no debe pasar por aquí.
 */

export interface GameAudio {
  date: string;
  /** Fuente preferida, fijada al crear la partida (`ecos_games.audio_source`). */
  audioSource: AudioSourceName;
  previewUrl: string | null;
  deezerId: number | null;
}

export function getGameAudioCached(gameId: string): Promise<GameAudio | null> {
  return unstable_cache(
    async (): Promise<GameAudio | null> => {
      const { data, error } = await createServiceClient()
        .from("ecos_games")
        .select("date, audio_source, ecos_songs(preview_url, deezer_id)")
        .eq("id", gameId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const song = unwrapToOne<{ preview_url: string | null; deezer_id: number | null }>(
        data.ecos_songs
      );
      return {
        date: data.date as string,
        audioSource: data.audio_source === "deezer" ? "deezer" : "spotify",
        previewUrl: song?.preview_url ?? null,
        deezerId: song?.deezer_id ?? null,
      };
    },
    ["game-audio-v2", gameId],
    { revalidate: 86400 }
  )();
}
