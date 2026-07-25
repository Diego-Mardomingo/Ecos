import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGameById } from "@/lib/queries/games";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { PlayGameWrapper } from "@/components/game/PlayGameWrapper";

export default async function PlayGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const game = await getGameById(gameId);

  // El juego del día siguiente ya existe en la BD (scripts/select-daily-game.py) y esta página
  // manda la canción completa al cliente: no se puede servir antes de su fecha.
  if (!game || game.date > getEffectiveGameDate()) {
    notFound();
  }

  return (
    <PlayGameWrapper
      gameId={gameId}
      initialGame={game}
      userId={user?.id ?? null}
    />
  );
}
