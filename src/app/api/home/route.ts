import { NextResponse } from "next/server";
import { loadHomePayload } from "@/lib/queries/home";
import { getRequestUser, handleRoute, PRIVATE_NO_STORE } from "@/lib/api/route";
import {
  getEffectiveGameDate,
  getTomorrowMadridDate,
  getMsUntilNextMidnightMadrid,
} from "@/lib/date-utils";

/**
 * Fecha de la carga: hoy, o mañana solo en el último minuto antes de la medianoche de Madrid
 * (la home la pide para tener el día siguiente listo al llegar a cero la cuenta atrás). Cualquier
 * otro valor se ignora: la canción de un día futuro no puede salir antes de tiempo.
 */
function resolveEffectiveDate(param: string | null): string {
  const today = getEffectiveGameDate();
  if (!param || param === today) return today;
  const isTomorrowAllowed = getMsUntilNextMidnightMadrid() < 60_000;
  if (param === getTomorrowMadridDate() && isTomorrowAllowed) return param;
  return today;
}

export const GET = handleRoute("api/home", async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const effectiveDate = resolveEffectiveDate(searchParams.get("effectiveDate"));

  const { supabase, user } = await getRequestUser();
  const home = await loadHomePayload({ supabase, user, effectiveDate });

  return NextResponse.json(
    {
      todaysGame: home.todaysGame,
      previousDays: home.previousDays,
      userStats: home.userStats,
      userId: home.userId,
      inProgressByGameId: home.inProgressByGameId,
      todaysCompletedResult: home.todaysCompletedResult,
      rankingRanks: home.rankingRanks,
      rankingStats: home.rankingStats,
    },
    { headers: PRIVATE_NO_STORE }
  );
});
