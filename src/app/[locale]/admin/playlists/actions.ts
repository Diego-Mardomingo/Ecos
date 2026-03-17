"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";

function extractSpotifyPlaylistId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const uri = raw.match(/^spotify:playlist:([a-zA-Z0-9]{10,40})$/);
  if (uri?.[1]) return uri[1];

  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => p === "playlist");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  } catch {
    // no es URL
  }

  const fallback = raw.match(/([a-zA-Z0-9]{10,40})/);
  return fallback?.[1] ?? null;
}

export async function addSpotifyPlaylist(params: {
  source: string;
  name?: string;
  ingest_mode: "default" | "all";
}) {
  const supabase = createServiceClient();
  const spotify_playlist_id = extractSpotifyPlaylistId(params.source);
  if (!spotify_playlist_id) return { error: "No se pudo extraer el ID de la playlist" };

  const spotify_playlist_name = (params.name ?? "").trim() || null;
  const source_url = params.source.trim() || null;

  const { error } = await supabase.from("ecos_spotify_playlists").insert({
    spotify_playlist_id,
    spotify_playlist_name,
    source_url,
    ingest_mode: params.ingest_mode,
    is_active: true,
  });

  if (error) {
    // Unique violation
    if (String(error.code) === "23505") {
      return { error: "Esa playlist ya existe en el pool" };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/playlists");
  return { ok: true };
}

export async function setPlaylistActive(id: string, is_active: boolean) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("ecos_spotify_playlists")
    .update({ is_active })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/playlists");
  return { ok: true };
}

export async function setPlaylistMode(id: string, ingest_mode: "default" | "all") {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("ecos_spotify_playlists")
    .update({ ingest_mode })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/playlists");
  return { ok: true };
}

export async function deletePlaylist(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("ecos_spotify_playlists").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/playlists");
  return { ok: true };
}

export async function reorderPlaylists(idsInOrder: string[]) {
  const supabase = createServiceClient();
  if (!Array.isArray(idsInOrder) || idsInOrder.length === 0) {
    return { ok: true };
  }

  // sort_order empieza en 1 para mantenerlo simple y estable
  for (let i = 0; i < idsInOrder.length; i++) {
    const id = idsInOrder[i];
    if (!id) continue;
    const { error } = await supabase
      .from("ecos_spotify_playlists")
      .update({ sort_order: i + 1 })
      .eq("id", id);
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/playlists");
  return { ok: true };
}

