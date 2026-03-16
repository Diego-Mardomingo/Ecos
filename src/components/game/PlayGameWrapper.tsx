"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useGameById } from "@/lib/hooks/queries";
import type { GameWithSong } from "@/lib/queries/games";

function PlayGameLoading() {
  const t = useTranslations("game");
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4">
      <span
        className="material-symbols-outlined animate-spin text-6xl text-brand"
        aria-hidden
      >
        progress_activity
      </span>
      <p className="text-sm text-muted-foreground">{t("preparingGame")}</p>
    </div>
  );
}

const GameClient = dynamic(
  () => import("@/components/game/GameClient").then((m) => ({ default: m.GameClient })),
  {
    loading: () => <PlayGameLoading />,
  }
);

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
