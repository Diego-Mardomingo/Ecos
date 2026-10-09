import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { unwrapToOne } from "@/lib/supabase/relations";

/**
 * `gameId → (fecha, preview_url)` en la caché de servidor, compartida por `/api/audio-url` y
 * `/api/audio-proxy`. Ese par no cambia nunca para un juego, así que la BD solo se consulta la
 * primera vez (PERFDB-16).
 *
 * Va con service role, por lo que la RLS de `ecos_games` no protege: **quien llame debe comparar
 * `date` con `getEffectiveGameDate()` en cada petición** (fuera de la caché, que guarda también
 * los juegos futuros) y responder a uno futuro igual que a uno inexistente (SEC-06 / B4-05).
 *
 * Solo vale para URL permanentes (Spotify). `unstable_cache` sirve el valor caducado mientras lo
 * refresca, así que una URL firmada con caducidad no debe pasar por aquí.
 */

export interface GameAudio {
  date: string;
  previewUrl: string | null;
}

export function getGameAudioCached(gameId: string): Promise<GameAudio | null> {
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
