import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserStats } from "@/lib/queries/users";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stats = await getUserStats(user.id);

    const { data: dbProfile } = await supabase
      .from("ecos_profiles")
      .select("display_name, avatar_url, role")
      .eq("user_id", user.id)
      .single();

    const profile = {
      id: user.id,
      display_name:
        dbProfile?.display_name ??
        user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        "Usuario",
      avatar_url:
        dbProfile?.avatar_url ??
        user.user_metadata?.avatar_url ??
        user.user_metadata?.picture ??
        "",
      created_at: user.created_at,
      email: user.email ?? "",
      role: (dbProfile as { display_name?: string; avatar_url?: string; role?: string } | null)?.role ?? null,
    };

    return NextResponse.json({ profile, stats });
  } catch (err) {
    console.error("api/profile error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
