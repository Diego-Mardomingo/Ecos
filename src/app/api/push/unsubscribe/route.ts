import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api/body-limit";
import { getRequestUser, handleRoute, jsonError } from "@/lib/api/route";

export const POST = handleRoute("api/push/unsubscribe", async (request: NextRequest) => {
  // Cuerpo opcional (sin `endpoint` se desactivan todas), pero con tope de tamaño.
  const body = await readJsonBody(request);
  if (!body.ok && body.response.status === 413) return body.response;
  const endpoint =
    body.ok && typeof body.data === "object" && body.data !== null
      ? (body.data as { endpoint?: unknown }).endpoint
      : undefined;

  const { supabase, user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  let query = supabase
    .from("ecos_push_subscriptions")
    .update({ enabled: false })
    .eq("user_id", user.id);

  if (typeof endpoint === "string" && endpoint) {
    query = query.eq("endpoint", endpoint);
  }

  const { error } = await query;
  if (error) throw error;

  return NextResponse.json({ ok: true });
});
