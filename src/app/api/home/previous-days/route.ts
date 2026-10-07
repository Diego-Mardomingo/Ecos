import { NextResponse } from "next/server";
import { loadHomeMonth } from "@/lib/queries/home";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { getRequestUser, handleRoute, jsonError, PRIVATE_NO_STORE } from "@/lib/api/route";

export const GET = handleRoute("api/home/previous-days", async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? getEffectiveGameDate().slice(0, 7);

  const { supabase, user } = await getRequestUser();
  const payload = await loadHomeMonth({ supabase, user, month });
  if (!payload) return jsonError(400, "Invalid month format");

  return NextResponse.json(payload, { headers: PRIVATE_NO_STORE });
});
