import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/server";
import { getTodaysGame } from "@/lib/queries/games";

const GameClient = dynamic(
  () => import("@/components/game/GameClient").then((m) => ({ default: m.GameClient })),
  {
    loading: () => (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4">
        <div className="h-16 w-16 animate-pulse rounded-2xl bg-muted" />
        <p className="text-sm text-muted-foreground">Cargando juego...</p>
      </div>
    ),
  }
);

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
