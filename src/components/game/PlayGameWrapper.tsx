"use client";

import { useTranslations } from "next-intl";
import { useGameById } from "@/lib/hooks/queries";
import type { GameWithSong } from "@/lib/queries/games";
import { GameClient } from "@/components/game/GameClient";

interface Props {
  gameId: string;
  initialGame: GameWithSong;
  userId: string | null;
}

export function PlayGameWrapper({ gameId, initialGame, userId }: Props) {
  const t = useTranslations("game");
  const { data: game, isLoading, isError } = useGameById(gameId, initialGame);

  if (isError || (!game && !isLoading)) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4">
        <p className="text-sm text-muted-foreground">{t("loadGameError")}</p>
      </div>
    );
  }

  return <GameClient game={game ?? initialGame} userId={userId} />;
}
