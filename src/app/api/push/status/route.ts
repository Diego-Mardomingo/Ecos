import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const hasEnabledSubscription = subscriptions.some((s) => s.enabled);
    const dismissCount =
      profileResult.data?.notifications_modal_dismiss_count ?? 0;

    return NextResponse.json({
      modal_dismiss_count: dismissCount,
      enabled: hasEnabledSubscription,
      endpoints: subscriptions.map((s) => s.endpoint).filter(Boolean),
    });
  } catch (err) {
    console.error("api/push/status GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** Incrementa el contador de cierres del modal (máx. 3) o lo fija a 3 si `exhaust: true`. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      exhaust?: boolean;
    };
    const exhaust = body.exhaust === true;

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

    return NextResponse.json({
      ok: true,
      notifications_modal_dismiss_count: next,
    });
  } catch (err) {
    console.error("api/push/status POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
