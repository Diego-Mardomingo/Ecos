import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getLeaderboardByPeriod,
  type LeaderboardPeriod,
} from "@/lib/queries/users";

const VALID_PERIODS: LeaderboardPeriod[] = ["weekly", "monthly", "global"];

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)),
      100
    );
    const periodParam = searchParams.get("period") ?? "global";
    const period: LeaderboardPeriod = VALID_PERIODS.includes(
      periodParam as LeaderboardPeriod
    )
      ? (periodParam as LeaderboardPeriod)
      : "global";

    const entries = await getLeaderboardByPeriod(period, limit);

    return NextResponse.json({
      entries,
      currentUserId: user?.id ?? null,
    });
  } catch (err) {
    console.error("api/ranking error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
