import { NextResponse } from "next/server";
import { loadHomeToday } from "@/lib/queries/home";
import { getRequestUser, handleRoute, PRIVATE_NO_STORE } from "@/lib/api/route";

export const GET = handleRoute("api/home/today", async () => {
  const { supabase, user } = await getRequestUser();
  const today = await loadHomeToday({ supabase, user });

  return NextResponse.json(
    {
      todaysGame: today.todaysGame,
      todaysCompletedResult: today.todaysCompletedResult,
      todaysInProgress: today.todaysInProgress,
      userId: today.userId,
    },
    { headers: PRIVATE_NO_STORE }
  );
});
