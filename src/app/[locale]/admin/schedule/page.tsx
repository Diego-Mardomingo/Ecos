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

  return <ScheduleClient games={games ?? []} />;
}
