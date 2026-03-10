import { createServiceClient } from "@/lib/supabase/server";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getMadridDate } from "@/lib/date-utils";

export default async function AdminSchedulePage() {
  const supabase = await createServiceClient();

  const today = getMadridDate();
  const { data: games } = await supabase
    .from("ecos_games")
    .select(
      `
      id, date, game_number,
      ecos_songs ( title, artist_name )
    `
    )
    .gte("date", today)
    .order("date", { ascending: true })
    .limit(30);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Próximos 30 días
      </h2>
      <div className="space-y-2">
        {(games ?? []).map((g) => {
          const song = (g.ecos_songs as unknown) as
            | { title: string; artist_name: string }
            | null;
          return (
            <div
              key={g.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  {format(new Date(g.date), "EEEE d MMM", { locale: es })}
                </p>
                <p className="text-sm text-muted-foreground">
                  Ecos #{g.game_number}
                  {song && ` — ${song.title} · ${song.artist_name}`}
                </p>
              </div>
            </div>
          );
        })}
        {(!games || games.length === 0) && (
          <p className="py-8 text-center text-muted-foreground">
            No hay días programados
          </p>
        )}
      </div>
    </div>
  );
}
