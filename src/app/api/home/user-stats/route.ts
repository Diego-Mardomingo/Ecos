import { NextResponse } from "next/server";
import { getUserDashboardStats } from "@/lib/queries/users";
import { getRequestUser, handleRoute, PRIVATE_NO_STORE } from "@/lib/api/route";

export const GET = handleRoute("api/home/user-stats", async () => {
  const { supabase, user } = await getRequestUser();

  if (!user) {
    return NextResponse.json(
      {
        userStats: null,
        rankingRanks: undefined,
        rankingStats: undefined,
        userId: null,
      },
      { headers: PRIVATE_NO_STORE }
    );
  }

  const dashboard = await getUserDashboardStats(user.id, supabase);
  return NextResponse.json(
    {
      userStats: dashboard.userStats,
      rankingRanks: dashboard.rankingRanks,
      rankingStats: dashboard.rankingStats,
      userId: user.id,
    },
    { headers: PRIVATE_NO_STORE }
  );
});
