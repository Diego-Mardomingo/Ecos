import type { createServiceClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { unwrapToOne } from "@/lib/supabase/relations";

/**
 * Reserva elegible del selector diario: cuántas canciones puede sortear todavía
 * `select-daily-game.py`, una por día. Si se agota, el selector falla y no hay juego.
 *
 * Es la regla 1 de `scripts/selection.py` (`is_eligible` + `UsedSongs.contains`) escrita otra
 * vez en TypeScript, porque el panel no puede ejecutar Python. Qué cuenta como elegible:
 * - canción activa, de una playlist activa, con `preview_url` y preview medido de al menos
 *   `MIN_PREVIEW_SECONDS` (aquí se aplica también en la consulta, para no traer el catálogo
 *   entero);
 * - con título y artista;
 * - que no haya salido ya en un juego: ni la misma canción (id), ni otra edición (`dedupe_key`),
 *   ni otra versión (`version_key`), ni el mismo audio (`preview_url`).
 *
 * Es una cota por arriba: no descuenta que elegir una canción deja fuera a las versiones que
 * comparten `version_key` con ella, ni las reglas de rotación 3-5 (que solo reducen candidatos
 * en una fecha concreta, con reserva en la regla 6). Las claves son una copia de `song_key.py`:
 * la única diferencia es que `\p{M}` (todas las marcas) sustituye a `unicodedata.combining`,
 * que solo se distingue con escrituras que no aparecen en el catálogo.
 *
 * Si cambia `MIN_PREVIEW_SECONDS` o la regla 1 en Python, hay que cambiarlo aquí.
 */
export const MIN_PREVIEW_SECONDS = 29;

/** Por debajo de esto (unos seis meses, a una canción por día) el panel avisa. */
export const RESERVE_WARNING = 180;
/** Por debajo de esto el aviso pasa a rojo. */
export const RESERVE_CRITICAL = 60;

type ServiceClient = ReturnType<typeof createServiceClient>;

type SongRow = {
  id: string;
  title: string | null;
  artist_name: string | null;
  preview_url: string | null;
  preview_duration_seconds: number | null;
  spotify_playlist_id: string | null;
};

type GameRow = {
  song_id: string;
  ecos_songs:
    | { title: string | null; artist_name: string | null; preview_url: string | null }
    | { title: string | null; artist_name: string | null; preview_url: string | null }[]
    | null;
};

// Separador entre título y artista, el mismo que en song_key.py.
const SEPARATOR = "\x1f";
// Solo los espacios que colapsa Postgres con '\s+', igual que en Python.
const SPACES = /[ \t\n\r\f\v]+/g;

function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(SPACES, " ")
    .trim()
    .toLowerCase();
}

function dedupeKey(title: string | null, artist: string | null): string | null {
  const t = normalize(title);
  const a = normalize(artist);
  if (!t && !a) return null;
  return `${t}${SEPARATOR}${a}`;
}

const ENTRE_PARENTESIS = /\s*[(\[][^)\]]*[)\]]/g;
const SUFIJO_GUION = /\s+-\s+.*$/;

function versionKey(title: string | null, artist: string | null): string | null {
  if (!title) return null;
  const base = title.replace(ENTRE_PARENTESIS, "").replace(SUFIJO_GUION, "");
  const t = normalize(base) || normalize(title);
  if (!t) return null;
  const firstArtist = normalize((artist ?? "").split(",")[0]);
  return `${t}${SEPARATOR}${firstArtist}`;
}

type Used = {
  ids: Set<string>;
  keys: Set<string>;
  versionKeys: Set<string>;
  previewUrls: Set<string>;
};

function usedContains(
  used: Used,
  song: { id: string; title: string | null; artist_name: string | null; preview_url: string | null }
): boolean {
  if (used.ids.has(song.id)) return true;
  const key = dedupeKey(song.title, song.artist_name);
  if (key && used.keys.has(key)) return true;
  const vk = versionKey(song.title, song.artist_name);
  if (vk && used.versionKeys.has(vk)) return true;
  return !!song.preview_url && used.previewUrls.has(song.preview_url);
}

export type ReserveInfo = {
  /** Canciones que cumplen los criterios del pool, hayan salido ya o no. */
  eligible: number;
  /** Las que, además, no han salido en ningún juego: lo que queda por sortear. */
  reserve: number;
};

export async function countSelectorReserve(supabase: ServiceClient): Promise<ReserveInfo> {
  const [{ data: playlists, error: playlistsError }, songs, games] = await Promise.all([
    supabase.from("ecos_spotify_playlists").select("spotify_playlist_id").eq("is_active", true),
    fetchAllRows<SongRow>((from, to) =>
      supabase
        .from("ecos_songs")
        .select(
          "id, title, artist_name, preview_url, preview_duration_seconds, spotify_playlist_id",
          { count: "exact" }
        )
        .eq("is_active", true)
        .not("preview_url", "is", null)
        .gte("preview_duration_seconds", MIN_PREVIEW_SECONDS)
        .order("id")
        .range(from, to)
    ),
    fetchAllRows<GameRow>((from, to) =>
      supabase
        .from("ecos_games")
        .select("song_id, ecos_songs(title, artist_name, preview_url)", { count: "exact" })
        .order("id")
        .range(from, to)
    ),
  ]);
  if (playlistsError) throw new Error(`Lectura de playlists fallida: ${playlistsError.message}`);

  const activePlaylistIds = new Set(
    (playlists ?? [])
      .map((p: { spotify_playlist_id: string | null }) => (p.spotify_playlist_id ?? "").trim())
      .filter(Boolean)
  );

  const used: Used = {
    ids: new Set(),
    keys: new Set(),
    versionKeys: new Set(),
    previewUrls: new Set(),
  };
  for (const g of games) {
    const song = unwrapToOne(g.ecos_songs);
    used.ids.add(String(g.song_id));
    if (!song) continue;
    const key = dedupeKey(song.title, song.artist_name);
    if (key) used.keys.add(key);
    const vk = versionKey(song.title, song.artist_name);
    if (vk) used.versionKeys.add(vk);
    if (song.preview_url) used.previewUrls.add(song.preview_url);
  }

  const eligible = songs.filter((s) => {
    const playlistId = (s.spotify_playlist_id ?? "").trim();
    return !!playlistId && activePlaylistIds.has(playlistId) && !!s.preview_url;
  });
  const reserve = eligible.filter((s) => s.title && s.artist_name && !usedContains(used, s));

  return { eligible: eligible.length, reserve: reserve.length };
}
