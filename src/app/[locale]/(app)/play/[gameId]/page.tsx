import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGameById } from "@/lib/queries/games";

const GameClient = dynamic(
  () => import("@/components/game/GameClient").then((m) => ({ default: m.GameClient })),
  {
    loading: () => (
      <div className="flex min-h-full flex-col items-center justify-center gap-6 px-4">
        <div className="aspect-square w-full max-w-[280px] animate-pulse rounded-2xl bg-muted" />
        <p className="text-sm text-muted-foreground">Preparando el juego...</p>
      </div>
    ),
  }
);

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
