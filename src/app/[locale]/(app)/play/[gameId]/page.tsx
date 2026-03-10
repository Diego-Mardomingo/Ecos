import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGameById } from "@/lib/queries/games";
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

  if (!game) {
    notFound();
  }

  return <GameClient game={game} userId={user?.id ?? null} />;
}
