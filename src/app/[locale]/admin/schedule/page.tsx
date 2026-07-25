import { createServiceClient } from "@/lib/supabase/server";
import { ScheduleClient } from "./ScheduleClient";

export default async function AdminSchedulePage() {
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

  // Supabase tipa el join to-one como array; en runtime es un objeto.
  const gameItems = (games ?? []).map((g) => ({
    id: g.id,
    date: g.date,
    game_number: g.game_number,
    ecos_songs: g.ecos_songs as unknown as {
      title: string;
      artist_name: string;
      spotify_playlist_name?: string | null;
    },
  }));

  return <ScheduleClient games={gameItems} />;
}
