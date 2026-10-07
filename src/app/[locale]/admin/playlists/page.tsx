import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { ageHours, formatAdminDate, formatAge } from "../_lib/format";
import { ingestionPlaylistFlags } from "../_lib/logSummary";
import { PlaylistsClient } from "./PlaylistsClient";

export const dynamic = "force-dynamic";

/** Ingestas recientes que se miran para decir cuánto lleva agotada una playlist. */
const RECENT_RUNS = 8;

function currentTime(): number {
  return Date.now();
}

export default async function AdminPlaylistsPage() {
  await requireAdminPage();

  const supabase = await createServiceClient();

  const [{ data: playlists }, { data: runs }] = await Promise.all([
    supabase
      .from("ecos_spotify_playlists")
      .select(
        "id, spotify_playlist_id, spotify_playlist_name, source_url, ingest_mode, is_active, created_at, sort_order, last_ingested_at"
      )
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("ecos_system_logs")
      .select("details")
      .eq("job_type", "ingestion")
      .order("ran_at", { ascending: false })
      .limit(RECENT_RUNS),
  ]);

  // Solo valen las ingestas que dejaron estadísticas por playlist (una interrumpida o fallida
  // puede no tenerlas).
  const flagsByRun = (runs ?? [])
    .map((r) => ingestionPlaylistFlags(r.details))
    .filter((flags) => flags.size > 0);

  const nowMs = currentTime();
  const rows = (playlists ?? []).map((p) => {
    // Ingestas seguidas, empezando por la última, en las que la playlist no aportó nada nuevo.
    // Si falta en una ingesta (inactiva entonces, o no se pudo leer), la racha se corta.
    let exhaustedRuns = 0;
    for (const flags of flagsByRun) {
      if (!flags.get(p.spotify_playlist_id)?.exhausted) break;
      exhaustedRuns++;
    }
    const lastRun = flagsByRun[0]?.get(p.spotify_playlist_id);
    return {
      ...p,
      ingested_label: p.last_ingested_at
        ? `${formatAge(ageHours(p.last_ingested_at, nowMs))} (${formatAdminDate(p.last_ingested_at)})`
        : null,
      exhausted_runs: exhaustedRuns,
      possibly_truncated: lastRun?.truncated === true,
    };
  });

  return <PlaylistsClient playlists={rows} />;
}
