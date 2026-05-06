import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      subscription?: unknown;
    };

    if (!isValidSubscription(body.subscription)) {
      return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
    }

    const subscription = body.subscription;

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
  } catch (err) {
    console.error("api/push/subscribe error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
