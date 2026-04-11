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

    const { data: dbProfile } = await supabase
      .from("ecos_profiles")
      .select("display_name, avatar_url, role, username, show_avatar_in_rankings")
      .eq("user_id", user.id)
      .single();

    const db = dbProfile as {
      display_name?: string;
      avatar_url?: string;
      role?: string;
      username?: string;
      show_avatar_in_rankings?: boolean;
    } | null;

    const profile = {
      id: user.id,
      display_name:
        db?.username ??
        db?.display_name ??
        user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        "Usuario",
      avatar_url:
        db?.avatar_url ??
        user.user_metadata?.avatar_url ??
        user.user_metadata?.picture ??
        "",
      show_avatar_in_rankings: db?.show_avatar_in_rankings ?? true,
      created_at: user.created_at,
      email: user.email ?? "",
      role: db?.role ?? null,
    };

    return NextResponse.json({ profile, userId: user.id });
  } catch (err) {
    console.error("api/profile/core error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
