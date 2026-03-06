import { createClient } from "@/lib/supabase/server";
import { getTodaysGame } from "@/lib/queries/games";
import { GameClient } from "@/components/game/GameClient";

export default async function PlayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const todaysGame = await getTodaysGame();

  if (!todaysGame) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <span className="material-symbols-outlined text-5xl text-muted-foreground">
          music_off
        </span>
        <p className="text-lg font-semibold">No hay reto disponible hoy</p>
        <p className="text-sm text-muted-foreground">Vuelve más tarde</p>
      </div>
    );
  }

  // userId es null para invitados — el juego se guarda en localStorage
  return <GameClient game={todaysGame} userId={user?.id ?? null} />;
}
