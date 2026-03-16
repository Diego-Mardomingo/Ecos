import { createServiceClient } from "@/lib/supabase/server";
import { CatalogClient } from "./CatalogClient";

export default async function AdminCatalogPage() {
  const supabase = await createServiceClient();

  const { data: songs } = await supabase
    .from("ecos_songs")
    .select("id, title, artist_name, cover_url, is_active, youtube_verified, spotify_playlist_name")
    .order("created_at", { ascending: false });

  return <CatalogClient songs={songs ?? []} />;
}
