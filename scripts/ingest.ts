/**
 * Script de ingesta: playlists Spotify -> ecos_songs.
 * Ejecución: pnpm run ingest
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import {
  getPlaylistTracks,
  getPlaylistName,
  type SpotifyTrack,
} from "../src/lib/spotify";
import { searchEmbeddableVideo } from "../src/lib/youtube";
import { SPOTIFY_PLAYLISTS } from "./config/playlists";
import { logJob } from "./lib/logger";

const POPULARITY_MIN = 65;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }
  return createClient(url, key);
}

async function main() {
  const start = Date.now();
  const supabase = getSupabase();
  const errors: string[] = [];
  const playlistsData: {
    id: string;
    name: string;
    songs_found: number;
    songs_added: number;
    skipped: { duplicates: number; no_youtube: number; low_popularity: number };
  }[] = [];
  let totalAdded = 0;
  let totalSkipped = 0;

  const { data: existingSongs } = await supabase
    .from("ecos_songs")
    .select("spotify_id");
  const existingIds = new Set(
    (existingSongs ?? []).map((s) => s.spotify_id).filter(Boolean)
  );

  // /audio-features deprecado para apps nuevas (403); no usar
  const audioFeatures = new Map();

  for (const playlistId of SPOTIFY_PLAYLISTS) {
    try {
      const [tracks, name] = await Promise.all([
        getPlaylistTracks(playlistId),
        getPlaylistName(playlistId).catch(() => playlistId),
      ]);

      let added = 0;
      const skipped = { duplicates: 0, no_youtube: 0, low_popularity: 0 };

      for (const track of tracks) {
        if (!track.id || (track.popularity ?? 0) < POPULARITY_MIN) {
          skipped.low_popularity++;
          continue;
        }
        if (existingIds.has(track.id)) {
          skipped.duplicates++;
          continue;
        }

        const youtubeId = await searchEmbeddableVideo(
          track.name,
          track.artists[0]?.name ?? ""
        );
        if (!youtubeId) {
          skipped.no_youtube++;
          continue;
        }

        const af = audioFeatures.get(track.id);
        const coverUrl = track.album?.images?.[0]?.url ?? null;

        const { error } = await supabase.from("ecos_songs").insert({
          spotify_id: track.id,
          youtube_id: youtubeId,
          youtube_verified: true,
          youtube_verified_at: new Date().toISOString(),
          title: track.name,
          artist_name: track.artists[0]?.name ?? "Unknown",
          album_title: track.album?.name ?? null,
          cover_url: coverUrl,
          popularity: track.popularity ?? null,
          duration_ms: track.duration_ms ?? null,
          tempo: af?.tempo ?? null,
          danceability: af?.danceability ?? null,
          energy: af?.energy ?? null,
          explicit: track.explicit ?? false,
          release_date: track.album?.release_date ?? null,
      spotify_playlist_id: playlistId,
      is_active: true,
    });

    if (error) {
        if (error.code === "23505") {
            existingIds.add(track.id);
            skipped.duplicates++;
          } else {
            errors.push(`Playlist ${playlistId} insert: ${error.message}`);
          }
          continue;
        }

        added++;
        existingIds.add(track.id);
      }

      totalAdded += added;
      totalSkipped += skipped.duplicates + skipped.no_youtube + skipped.low_popularity;

      playlistsData.push({
        id: playlistId,
        name,
        songs_found: tracks.length,
        songs_added: added,
        skipped,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Playlist ${playlistId}: ${msg}`);
    }
  }

  const durationMs = Date.now() - start;
  const status =
    errors.length > 0 && totalAdded === 0 ? "failure" : errors.length > 0 ? "partial" : "success";
  const summary =
    totalAdded > 0
      ? `${totalAdded} canciones añadidas`
      : errors.length > 0
        ? `Error: ${errors[0]}`
        : "Sin canciones nuevas";

  await logJob({
    job_type: "ingestion",
    status,
    summary,
    duration_ms: durationMs,
    errors: errors.length ? errors : undefined,
    details: {
      playlists: playlistsData,
      totals: {
        playlists_checked: SPOTIFY_PLAYLISTS.length,
        songs_added: totalAdded,
        songs_skipped: totalSkipped,
      },
    },
  });

  console.log(summary);
  console.log(`Duración: ${durationMs}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
