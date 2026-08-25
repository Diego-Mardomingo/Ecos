import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGameById } from "@/lib/queries/games";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { GameClient } from "@/components/game/GameClient";

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

  // Sin capa cliente intermedia: el juego de un día no cambia nunca, así que el render de
  // servidor es siempre la versión más fresca que puede haber.
  return <GameClient game={game} userId={user?.id ?? null} />;
}
