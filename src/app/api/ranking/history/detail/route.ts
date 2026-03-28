import { NextRequest, NextResponse } from "next/server";
import { addDays, endOfMonth, format, parse } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { getLeaderboardByPeriod } from "@/lib/queries/users";
import type { LeaderboardHistoryGranularity } from "@/lib/queries/leaderboard-history";

const VALID: LeaderboardHistoryGranularity[] = ["weekly", "monthly"];

function parseISODate(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const granularityParam = searchParams.get("granularity");
    if (
      !granularityParam ||
      !VALID.includes(granularityParam as LeaderboardHistoryGranularity)
    ) {
      return NextResponse.json(
        { error: "granularity must be weekly or monthly" },
        { status: 400 }
      );
    }
    const granularity = granularityParam as LeaderboardHistoryGranularity;

    const anchorRaw = searchParams.get("anchor") ?? "";
    const anchor = parseISODate(anchorRaw);
    if (!anchor) {
      return NextResponse.json(
        { error: "Invalid or missing anchor (use YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const limit = Math.min(
      Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)),
      100
    );

    const entries = await getLeaderboardByPeriod(
      granularity,
      limit,
      anchor
    );

    const startParsed = parse(anchor, "yyyy-MM-dd", new Date());
    const periodEnd =
      granularity === "weekly"
        ? format(addDays(startParsed, 6), "yyyy-MM-dd")
        : format(endOfMonth(startParsed), "yyyy-MM-dd");

    return NextResponse.json({
      entries,
      currentUserId: user?.id ?? null,
      granularity,
      anchor,
      periodStart: anchor,
      periodEnd,
    });
  } catch (err) {
    console.error("api/ranking/history/detail error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
