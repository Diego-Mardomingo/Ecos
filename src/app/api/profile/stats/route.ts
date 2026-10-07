import { NextResponse } from "next/server";
import { getRequestUser, handleRoute, jsonError, PRIVATE_NO_STORE } from "@/lib/api/route";
import { getUserStats } from "@/lib/queries/users";

export const GET = handleRoute("api/profile/stats", async () => {
  const { supabase, user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  const stats = await getUserStats(user.id, supabase);
  return NextResponse.json({ stats, userId: user.id }, { headers: PRIVATE_NO_STORE });
});
