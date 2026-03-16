import dynamic from "next/dynamic";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTodaysGame } from "@/lib/queries/games";
import { GameLoadingFallback } from "@/components/game/GameLoadingFallback";

const GameClient = dynamic(
  () => import("@/components/game/GameClient").then((m) => ({ default: m.GameClient })),
  {
    loading: () => <GameLoadingFallback />,
  }
);

export default async function PlayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const todaysGame = await getTodaysGame();

  if (!todaysGame) {
    const t = await getTranslations("game");
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <span className="material-symbols-outlined text-5xl text-muted-foreground">
          music_off
        </span>
        <p className="text-lg font-semibold">{t("noChallengeToday")}</p>
        <p className="text-sm text-muted-foreground">{t("comeBackLater")}</p>
      </div>
    );
  }

  // userId es null para invitados — el juego se guarda en localStorage
  return <GameClient game={todaysGame} userId={user?.id ?? null} />;
}
