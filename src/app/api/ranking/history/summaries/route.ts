import { NextRequest, NextResponse } from "next/server";
import {
  fetchLeaderboardPeriodSummaries,
  LEADERBOARD_HISTORY_GRANULARITIES,
  WEEKLY_SUMMARIES_DEFAULT,
  WEEKLY_SUMMARIES_MAX,
} from "@/lib/queries/leaderboard-history";
import { getSecondsUntilNextMidnightMadrid } from "@/lib/date-utils";
import {
  handleRoute,
  jsonError,
  parseEnumParam,
  parseIntParam,
  publicCacheHeaders,
} from "@/lib/api/route";

/**
 * Ganadores de semanas y meses cerrados. Igual para todos y sin cookies (cliente anónimo dentro de
 * la caché de servidor): va a la CDN como mucho una hora y nunca más allá de la medianoche de
 * Madrid, que es cuando puede cerrarse un periodo.
 */
export const GET = handleRoute("api/ranking/history/summaries", async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const granularity = parseEnumParam(
    searchParams.get("granularity"),
    LEADERBOARD_HISTORY_GRANULARITIES
  );
  if (!granularity) return jsonError(400, "granularity must be weekly or monthly");

  const summaries =
    granularity === "monthly"
      ? await fetchLeaderboardPeriodSummaries("monthly")
      : await fetchLeaderboardPeriodSummaries(
          "weekly",
          parseIntParam(searchParams.get("limit"), {
            fallback: WEEKLY_SUMMARIES_DEFAULT,
            min: 1,
            max: WEEKLY_SUMMARIES_MAX,
          })
        );

  const sMaxAge = Math.min(3600, getSecondsUntilNextMidnightMadrid());
  return NextResponse.json({ summaries }, { headers: publicCacheHeaders(sMaxAge, 600) });
});
