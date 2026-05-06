import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
      endpoint?: string;
    };

    let query = supabase
      .from("ecos_push_subscriptions")
      .update({ enabled: false })
      .eq("user_id", user.id);

    if (body.endpoint) {
      query = query.eq("endpoint", body.endpoint);
    }

    const { error } = await query;
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("api/push/unsubscribe error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
