import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api/body-limit";
import { getRequestUser, handleRoute, jsonError } from "@/lib/api/route";

interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime: number | null;
  keys: PushSubscriptionKeys;
}

function isValidSubscription(value: unknown): value is PushSubscriptionPayload {
  if (!value || typeof value !== "object") return false;
  const sub = value as Record<string, unknown>;
  if (typeof sub.endpoint !== "string" || !sub.endpoint) return false;
  const keys = sub.keys as Record<string, unknown> | undefined;
  if (!keys || typeof keys !== "object") return false;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}

export const POST = handleRoute("api/push/subscribe", async (request: NextRequest) => {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const { supabase, user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  const subscription = (body.data as { subscription?: unknown } | null)?.subscription;
  if (!isValidSubscription(subscription)) {
    return jsonError(400, "invalid_subscription");
  }

  const { data: existing, error: fetchError } = await supabase
    .from("ecos_push_subscriptions")
    .select("id")
    .eq("user_id", user.id)
    .eq("endpoint", subscription.endpoint)
    .maybeSingle();

  if (fetchError) throw fetchError;

  if (existing) {
    const { error } = await supabase
      .from("ecos_push_subscriptions")
      .update({
        subscription: subscription as unknown as Record<string, unknown>,
        enabled: true,
      })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("ecos_push_subscriptions").insert({
      user_id: user.id,
      subscription: subscription as unknown as Record<string, unknown>,
      enabled: true,
    });
    if (error) throw error;
  }

  return NextResponse.json({ ok: true });
});
