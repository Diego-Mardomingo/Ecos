import { NextRequest, NextResponse } from "next/server";
import { getLeaderboardByPeriod, LEADERBOARD_PERIODS } from "@/lib/queries/users";
import {
  getRequestUser,
  handleRoute,
  parseEnumParam,
  parseIntParam,
  PRIVATE_NO_STORE,
} from "@/lib/api/route";

/**
 * Ranking de un periodo en curso. Lleva `currentUserId`, así que es personal (`private,
 * no-store`) y no hay caché de servidor del ranking: es en tiempo real (ver
 * `getLeaderboardByPeriod`).
 */
export const GET = handleRoute("api/ranking", async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const limit = parseIntParam(searchParams.get("limit"), { fallback: 50, min: 1, max: 100 });
  const period = parseEnumParam(searchParams.get("period"), LEADERBOARD_PERIODS) ?? "global";

  // El ranking no depende de la sesión: va a la vez que `getUser()`.
  const [{ user }, entries] = await Promise.all([
    getRequestUser(),
    getLeaderboardByPeriod(period, limit),
  ]);

  return NextResponse.json(
    {
      entries,
      currentUserId: user?.id ?? null,
    },
    { headers: PRIVATE_NO_STORE }
  );
});
