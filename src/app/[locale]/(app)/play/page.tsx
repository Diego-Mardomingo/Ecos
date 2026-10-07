import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getTodaysGameCached } from "@/lib/queries/games";
import { GameClient } from "@/components/game/GameClient";

/**
 * Sin indexar: el HTML lleva la canción de hoy completa (el invitado compara en local). Igual que
 * `/play/[gameId]`; no va en robots.txt para que el bot llegue a leer el `noindex`.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PlayPage() {
  const supabase = await createClient();
  // La canción de hoy (caché de servidor) no depende de la sesión: van a la vez.
  const [
    {
      data: { user },
    },
    todaysGame,
  ] = await Promise.all([supabase.auth.getUser(), getTodaysGameCached()]);

  if (!todaysGame) {
    const t = await getTranslations("game");
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <span aria-hidden className="material-symbols-outlined text-5xl text-muted-foreground">
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
