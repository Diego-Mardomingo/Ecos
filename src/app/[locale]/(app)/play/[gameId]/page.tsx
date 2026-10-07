import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGameByIdCached, isFutureGame } from "@/lib/queries/games";
import { GameClient } from "@/components/game/GameClient";
import { isUuid } from "@/lib/api/route";

/**
 * Sin indexar y sin nada del reto: el HTML de esta página lleva la canción completa (el invitado
 * compara en local), así que un buscador no debe poder mostrarla. Título y descripción son los
 * genéricos del layout; nunca `game.*`. Tampoco va en robots.txt: el bot tiene que llegar a leer
 * el `noindex`.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PlayGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const supabase = await createClient();
  // El juego (caché de servidor, con service role) no depende de la sesión: van a la vez.
  const [
    {
      data: { user },
    },
    game,
  ] = await Promise.all([
    supabase.auth.getUser(),
    isUuid(gameId) ? getGameByIdCached(gameId) : Promise.resolve(null),
  ]);

  // El juego del día siguiente ya existe en la BD (scripts/select-daily-game.py) y esta página
  // manda la canción completa al cliente: no se puede servir antes de su fecha. Esta comprobación
  // es la única barrera: el juego se lee con service role, sin la RLS de ecos_games.
  if (!game || isFutureGame(game)) {
    notFound();
  }

  // Sin capa cliente intermedia: el juego de un día no cambia nunca, así que el render de
  // servidor es siempre la versión más fresca que puede haber.
  return <GameClient game={game} userId={user?.id ?? null} />;
}
