import { createServiceClient } from "@/lib/supabase/server";
import { unwrapToOne } from "@/lib/supabase/relations";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { ScheduleClient } from "./ScheduleClient";

export default async function AdminSchedulePage() {
  await requireAdminPage();

  const supabase = await createServiceClient();

  const { data: games } = await supabase
    .from("ecos_games")
    .select(
      `
      id, date, game_number,
      ecos_songs ( title, artist_name, spotify_playlist_name )
    `
    )
    .order("date", { ascending: false })
    .order("game_number", { ascending: false });

  const gameItems = (games ?? []).map((g) => ({
    id: g.id,
    date: g.date,
    game_number: g.game_number,
    // ScheduleClient ya sabe pintar un juego sin canción; el cast anterior lo daba por imposible.
    ecos_songs: unwrapToOne<{
      title: string;
      artist_name: string;
      spotify_playlist_name?: string | null;
    }>(g.ecos_songs),
  }));

  return <ScheduleClient games={gameItems} />;
}
