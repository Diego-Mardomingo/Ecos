import { NextRequest, NextResponse } from "next/server";
import { addDays, endOfMonth, format, parse } from "date-fns";
import {
  getClosedPeriodLeaderboardCached,
  getLeaderboardForReference,
} from "@/lib/queries/users";
import { LEADERBOARD_HISTORY_GRANULARITIES } from "@/lib/queries/leaderboard-history";
import { getEffectiveGameDate } from "@/lib/date-utils";
import {
  getRequestUser,
  handleRoute,
  jsonError,
  parseEnumParam,
  parseIntParam,
  PRIVATE_NO_STORE,
} from "@/lib/api/route";

function parseISODate(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

/**
 * Ranking de una semana o un mes del histórico. Lleva `currentUserId` (personal: `private,
 * no-store`), pero el ranking de un periodo ya cerrado no cambia y va con caché de servidor.
 */
export const GET = handleRoute("api/ranking/history/detail", async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const granularity = parseEnumParam(
    searchParams.get("granularity"),
    LEADERBOARD_HISTORY_GRANULARITIES
  );
  if (!granularity) return jsonError(400, "granularity must be weekly or monthly");

  const anchor = parseISODate(searchParams.get("anchor") ?? "");
  if (!anchor) return jsonError(400, "Invalid or missing anchor (use YYYY-MM-DD)");

  const limit = parseIntParam(searchParams.get("limit"), { fallback: 50, min: 1, max: 100 });

  const startParsed = parse(anchor, "yyyy-MM-dd", new Date());
  const periodEnd =
    granularity === "weekly"
      ? format(addDays(startParsed, 6), "yyyy-MM-dd")
      : format(endOfMonth(startParsed), "yyyy-MM-dd");

  // La RPC calcula la semana del lunes de `anchor` (o el mes de `anchor`), que nunca acaba
  // después de `periodEnd`: si este ya pasó, el periodo está cerrado.
  const isClosed = periodEnd < getEffectiveGameDate();

  const [{ user }, entries] = await Promise.all([
    getRequestUser(),
    isClosed
      ? getClosedPeriodLeaderboardCached(granularity, limit, anchor)
      : getLeaderboardForReference(granularity, limit, anchor),
  ]);

  return NextResponse.json(
    {
      entries,
      currentUserId: user?.id ?? null,
      granularity,
      anchor,
      periodStart: anchor,
      periodEnd,
    },
    { headers: PRIVATE_NO_STORE }
  );
});
