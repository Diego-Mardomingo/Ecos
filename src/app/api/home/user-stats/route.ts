import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserDashboardStats } from "@/lib/queries/users";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({
        userStats: null,
        rankingRanks: undefined,
        rankingStats: undefined,
        userId: null,
      });
    }

    const dashboard = await getUserDashboardStats(user.id);
    return NextResponse.json({
      userStats: dashboard.userStats,
      rankingRanks: dashboard.rankingRanks,
      rankingStats: dashboard.rankingStats,
      userId: user.id,
    });
  } catch (err) {
    console.error("api/home/user-stats error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
