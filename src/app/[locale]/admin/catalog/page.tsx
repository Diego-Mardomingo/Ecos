import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { CatalogClient } from "./CatalogClient";

const COLUMNS = "id, title, artist_name, cover_url, is_active, spotify_playlist_name";

export default async function AdminCatalogPage() {
  await requireAdminPage();

  const supabase = await createServiceClient();

  // Paginado: el catálogo pasa de 1.000 canciones y un select suelto se queda en las primeras
  // 1.000 sin avisar. El desempate por id hace determinista el orden entre páginas.
  const songs = await fetchAllRows((from, to) =>
    supabase
      .from("ecos_songs")
      .select(COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
  );

  return <CatalogClient songs={songs} />;
}
