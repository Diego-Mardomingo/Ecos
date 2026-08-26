"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";

/** Los argumentos de una server action llegan del cliente: hay que validarlos igual que un body. */
const IdSchema = z.string().uuid();
const IngestModeSchema = z.enum(["default", "all"]);

const AddPlaylistSchema = z.object({
  source: z.string().min(1).max(500),
  name: z.string().max(200).optional(),
  ingest_mode: IngestModeSchema,
});

const ReorderSchema = z.array(IdSchema).max(200);

const INVALID_INPUT = { error: "Datos no válidos" } as const;

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
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = AddPlaylistSchema.safeParse(params);
  if (!parsed.success) return INVALID_INPUT;

  const supabase = createServiceClient();
  const spotify_playlist_id = extractSpotifyPlaylistId(parsed.data.source);
  if (!spotify_playlist_id) return { error: "No se pudo extraer el ID de la playlist" };

  const spotify_playlist_name = (parsed.data.name ?? "").trim() || null;
  const source_url = parsed.data.source.trim() || null;

  const { error } = await supabase.from("ecos_spotify_playlists").insert({
    spotify_playlist_id,
    spotify_playlist_name,
    source_url,
    ingest_mode: parsed.data.ingest_mode,
    is_active: true,
  });

  if (error) {
    // Unique violation
    if (String(error.code) === "23505") {
      return { error: "Esa playlist ya existe en el pool" };
    }
    console.error("addSpotifyPlaylist error:", error);
    return { error: "No se pudo añadir la playlist" };
  }

  revalidatePath("/admin/playlists");
  return { ok: true };
}

export async function setPlaylistActive(id: string, is_active: boolean) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsedId = IdSchema.safeParse(id);
  const parsedActive = z.boolean().safeParse(is_active);
  if (!parsedId.success || !parsedActive.success) return INVALID_INPUT;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("ecos_spotify_playlists")
    .update({ is_active: parsedActive.data })
    .eq("id", parsedId.data);
  if (error) {
    console.error("setPlaylistActive error:", error);
    return { error: "No se pudo actualizar la playlist" };
  }
  revalidatePath("/admin/playlists");
  return { ok: true };
}

export async function setPlaylistMode(id: string, ingest_mode: "default" | "all") {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsedId = IdSchema.safeParse(id);
  const parsedMode = IngestModeSchema.safeParse(ingest_mode);
  if (!parsedId.success || !parsedMode.success) return INVALID_INPUT;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("ecos_spotify_playlists")
    .update({ ingest_mode: parsedMode.data })
    .eq("id", parsedId.data);
  if (error) {
    console.error("setPlaylistMode error:", error);
    return { error: "No se pudo actualizar la playlist" };
  }
  revalidatePath("/admin/playlists");
  return { ok: true };
}

export async function deletePlaylist(id: string) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return INVALID_INPUT;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("ecos_spotify_playlists")
    .delete()
    .eq("id", parsed.data);
  if (error) {
    console.error("deletePlaylist error:", error);
    return { error: "No se pudo eliminar la playlist" };
  }
  revalidatePath("/admin/playlists");
  return { ok: true };
}

export async function reorderPlaylists(idsInOrder: string[]) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = ReorderSchema.safeParse(idsInOrder);
  if (!parsed.success) return INVALID_INPUT;
  if (parsed.data.length === 0) return { ok: true };

  const supabase = createServiceClient();

  // sort_order empieza en 1 para mantenerlo simple y estable
  for (let i = 0; i < parsed.data.length; i++) {
    const id = parsed.data[i];
    if (!id) continue;
    const { error } = await supabase
      .from("ecos_spotify_playlists")
      .update({ sort_order: i + 1 })
      .eq("id", id);
    if (error) {
      console.error("reorderPlaylists error:", error);
      return { error: "No se pudo reordenar la playlist" };
    }
  }

  revalidatePath("/admin/playlists");
  return { ok: true };
}

