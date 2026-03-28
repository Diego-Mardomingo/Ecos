import { NextRequest, NextResponse } from "next/server";
import {
  getLeaderboardPeriodSummaries,
  type LeaderboardHistoryGranularity,
} from "@/lib/queries/leaderboard-history";

const VALID: LeaderboardHistoryGranularity[] = ["weekly", "monthly"];

export async function GET(request: NextRequest) {
  try {
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

    const summaries =
      granularity === "monthly"
        ? await getLeaderboardPeriodSummaries("monthly")
        : await getLeaderboardPeriodSummaries(
            "weekly",
            Math.min(
              Math.max(1, parseInt(searchParams.get("limit") ?? "12", 10)),
              52
            )
          );

    return NextResponse.json({ summaries });
  } catch (err) {
    console.error("api/ranking/history/summaries error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
