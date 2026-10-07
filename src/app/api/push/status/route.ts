import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api/body-limit";
import { getRequestUser, handleRoute, jsonError, PRIVATE_NO_STORE } from "@/lib/api/route";
import { summarizeNotifications } from "@/lib/queries/profile";

export const GET = handleRoute("api/push/status GET", async () => {
  const { supabase, user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  const [profileResult, subsResult] = await Promise.all([
    supabase
      .from("ecos_profiles")
      .select("notifications_modal_dismiss_count")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("ecos_push_subscriptions")
      .select("endpoint, enabled")
      .eq("user_id", user.id),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (subsResult.error) throw subsResult.error;

  const subscriptions = subsResult.data ?? [];
  const status = summarizeNotifications(
    subscriptions,
    profileResult.data?.notifications_modal_dismiss_count
  );

  return NextResponse.json(
    {
      modal_dismiss_count: status.modalDismissCount,
      enabled: status.enabled,
      endpoints: subscriptions.map((s) => s.endpoint).filter(Boolean),
    },
    { headers: PRIVATE_NO_STORE }
  );
});

/** Incrementa el contador de cierres del modal (máx. 3) o lo fija a 3 si `exhaust: true`. */
export const POST = handleRoute("api/push/status POST", async (request: NextRequest) => {
  // Cuerpo opcional: sin cuerpo o con JSON roto se trata como `{}` (suma uno), pero uno enorme se corta.
  const body = await readJsonBody(request);
  if (!body.ok && body.response.status === 413) return body.response;
  const exhaust =
    body.ok &&
    typeof body.data === "object" &&
    body.data !== null &&
    (body.data as { exhaust?: unknown }).exhaust === true;

  const { supabase, user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  if (exhaust) {
    const { error } = await supabase
      .from("ecos_profiles")
      .update({ notifications_modal_dismiss_count: 3 })
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true, notifications_modal_dismiss_count: 3 });
  }

  const { data: row, error: selErr } = await supabase
    .from("ecos_profiles")
    .select("notifications_modal_dismiss_count")
    .eq("user_id", user.id)
    .maybeSingle();

  if (selErr) throw selErr;

  const current = row?.notifications_modal_dismiss_count ?? 0;
  const next = Math.min(current + 1, 3);

  const { error } = await supabase
    .from("ecos_profiles")
    .update({ notifications_modal_dismiss_count: next })
    .eq("user_id", user.id);

  if (error) throw error;

  return NextResponse.json({ ok: true, notifications_modal_dismiss_count: next });
});
