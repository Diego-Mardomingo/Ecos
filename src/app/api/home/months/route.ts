import { NextResponse } from "next/server";
import { getPastMonthKeys } from "@/lib/queries/games";
import { getEffectiveGameDate, getSecondsUntilNextMidnightMadrid } from "@/lib/date-utils";
import { handleRoute, publicCacheHeaders } from "@/lib/api/route";

/**
 * Meses con juegos (más el actual), del más reciente al más antiguo. Igual para todos y solo
 * cambia con el día: va a la CDN hasta la medianoche de Madrid. No lee cookies (el calendario sale
 * de la caché de servidor, con service role), así que la respuesta no puede llevar `Set-Cookie`.
 */
export const GET = handleRoute("api/home/months", async () => {
  const today = getEffectiveGameDate();
  const monthKeys = new Set<string>([today.slice(0, 7), ...(await getPastMonthKeys(today))]);

  return NextResponse.json(
    { monthKeys: [...monthKeys].sort((a, b) => b.localeCompare(a)) },
    { headers: publicCacheHeaders(getSecondsUntilNextMidnightMadrid()) }
  );
});
