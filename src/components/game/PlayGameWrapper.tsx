"use client";

import dynamic from "next/dynamic";
import { useGameById } from "@/lib/hooks/queries";
import type { GameWithSong } from "@/lib/queries/games";

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

interface Props {
  gameId: string;
  initialGame: GameWithSong;
  userId: string | null;
}

export function PlayGameWrapper({ gameId, initialGame, userId }: Props) {
  const { data: game, isLoading, isError } = useGameById(gameId, initialGame);

  if (isError || (!game && !isLoading)) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4">
        <p className="text-sm text-muted-foreground">No se pudo cargar el juego</p>
      </div>
    );
  }

  return <GameClient game={game ?? initialGame} userId={userId} />;
}
