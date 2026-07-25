/**
 * Script de verificación: revisa youtube_id en ecos_songs.
 * Si 404 o no embeddable -> is_active = FALSE.
 * Ejecución: pnpm run verify-youtube
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { logJob } from "./lib/logger";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const YT_TIMEOUT_MS = 10000;
// Si se desactivaría más de este % del catálogo verificado, algo va mal
// (cuota, key, cambio de API) — abortar sin tocar la BD.
const MAX_DEACTIVATION_RATIO = 0.2;

class YouTubeApiError extends Error {}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }
  return createClient(url, key);
}

/**
 * @returns true si el vídeo es embebible, false si NO existe / no es embebible.
 * @throws YouTubeApiError si la API falla (cuota/auth/5xx) — NO se debe desactivar en ese caso.
 */
async function checkVideo(apiKey: string, videoId: string): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/videos?part=status&id=${videoId}&key=${apiKey}`,
    { signal: AbortSignal.timeout(YT_TIMEOUT_MS) }
  );
  if (!res.ok) {
    // 401/403/429/5xx = problema de la API, no "el vídeo no vale".
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
      throw new YouTubeApiError(`YouTube API failure: ${res.status}`);
    }
    return false;
  }
  const data = (await res.json()) as { items?: { status?: { embeddable?: boolean } }[] };
  const item = data.items?.[0];
  return item?.status?.embeddable === true;
}

async function main() {
  const start = Date.now();
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY required");
  }

  const supabase = getSupabase();

  const { data: songs, error: fetchError } = await supabase
    .from("ecos_songs")
    .select("id, youtube_id, title, artist_name")
    .eq("is_active", true)
    .not("youtube_id", "is", null);

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  // Fase 1: recolectar candidatos a desactivar SIN escribir en la BD todavía.
  const toDeactivate: { song_id: string; title: string; artist: string; reason: string }[] = [];
  let checked = 0;

  try {
    for (const song of songs ?? []) {
      const ytId = song.youtube_id as string;
      if (!ytId) continue;

      checked++;
      const ok = await checkVideo(apiKey, ytId);

      if (!ok) {
        toDeactivate.push({
          song_id: song.id,
          title: song.title ?? "",
          artist: song.artist_name ?? "",
          reason: "404 o no embeddable",
        });
      }
    }
  } catch (e) {
    if (e instanceof YouTubeApiError) {
      const msg = `Abortado por fallo de la API de YouTube (no se desactivó nada): ${e.message}`;
      await logJob({
        job_type: "verify_youtube",
        status: "failure",
        summary: msg,
        duration_ms: Date.now() - start,
        details: { songs_checked: checked },
      });
      console.error(msg);
      process.exit(1);
    }
    throw e;
  }

  // Circuit breaker: si la fracción a desactivar es anómala, no aplicar nada.
  const ratio = checked > 0 ? toDeactivate.length / checked : 0;
  if (toDeactivate.length > 5 && ratio > MAX_DEACTIVATION_RATIO) {
    const msg = `Abortado: se desactivarían ${toDeactivate.length}/${checked} (${(ratio * 100).toFixed(0)}%), posible problema de API`;
    await logJob({
      job_type: "verify_youtube",
      status: "failure",
      summary: msg,
      duration_ms: Date.now() - start,
      details: { songs_checked: checked, would_deactivate: toDeactivate.length },
    });
    console.error(msg);
    process.exit(1);
  }

  // Fase 2: aplicar las desactivaciones ya validadas.
  const deactivated: typeof toDeactivate = [];
  for (const d of toDeactivate) {
    await supabase.from("ecos_songs").update({ is_active: false }).eq("id", d.song_id);
    deactivated.push(d);
  }

  const durationMs = Date.now() - start;
  const status = deactivated.length > 0 ? "partial" : "success";
  const summary =
    deactivated.length > 0
      ? `${deactivated.length} canciones desactivadas`
      : `${checked} canciones verificadas, todas OK`;

  await logJob({
    job_type: "verify_youtube",
    status,
    summary,
    duration_ms: durationMs,
    details: {
      songs_checked: checked,
      songs_deactivated: deactivated.length,
      deactivated,
    },
  });

  console.log(summary);
  console.log(`Duración: ${durationMs}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
