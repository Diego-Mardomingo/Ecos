import { NextResponse } from "next/server";
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
        .select("notifications_modal_shown")
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

    return NextResponse.json({
      modal_shown: profileResult.data?.notifications_modal_shown ?? false,
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

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabase
      .from("ecos_profiles")
      .update({ notifications_modal_shown: true })
      .eq("user_id", user.id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("api/push/status POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
