import { createServiceClient } from "@/lib/supabase/server";
import { PlaylistsClient } from "./PlaylistsClient";

export const dynamic = "force-dynamic";

export default async function AdminPlaylistsPage() {
  const supabase = await createServiceClient();

  const { data: playlists } = await supabase
    .from("ecos_spotify_playlists")
    .select(
      "id, spotify_playlist_id, spotify_playlist_name, source_url, ingest_mode, is_active, created_at, sort_order"
    )
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return <PlaylistsClient playlists={playlists ?? []} />;
}

