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

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }
  return createClient(url, key);
}

async function checkVideo(apiKey: string, videoId: string): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/videos?part=status&id=${videoId}&key=${apiKey}`
  );
  if (!res.ok) return false;
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

  const deactivated: { song_id: string; title: string; artist: string; reason: string }[] = [];
  let checked = 0;

  for (const song of songs ?? []) {
    const ytId = song.youtube_id as string;
    if (!ytId) continue;

    checked++;
    const ok = await checkVideo(apiKey, ytId);

    if (!ok) {
      await supabase
        .from("ecos_songs")
        .update({ is_active: false })
        .eq("id", song.id);

      deactivated.push({
        song_id: song.id,
        title: song.title ?? "",
        artist: song.artist_name ?? "",
        reason: "404 o no embeddable",
      });
    }
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
