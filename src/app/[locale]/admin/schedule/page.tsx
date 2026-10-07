import { createServiceClient } from "@/lib/supabase/server";
import { unwrapToOne } from "@/lib/supabase/relations";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { addCalendarDays, getEffectiveGameDate } from "@/lib/date-utils";
import { formatGameDate } from "../_lib/format";
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

  // Hoy y mañana son críticos (sin juego, /play queda vacío); pasado mañana aún deja margen al
  // cron del selector. Mismas reglas que scripts/check-games.py.
  const today = getEffectiveGameDate();
  const present = new Set(gameItems.map((g) => g.date));
  const missing = [
    { date: today, label: "hoy", critical: true },
    { date: addCalendarDays(today, 1), label: "mañana", critical: true },
    { date: addCalendarDays(today, 2), label: "pasado mañana", critical: false },
  ]
    .filter((d) => !present.has(d.date))
    .map((d) => ({ ...d, date: formatGameDate(d.date) }));

  return <ScheduleClient games={gameItems} missing={missing} />;
}
