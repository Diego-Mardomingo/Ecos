import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserStats } from "@/lib/queries/users";

// Permite letras, números, _, espacios y emojis (3-50 caracteres/code points)
const USERNAME_REGEX = /^[\p{L}\p{N}_ \p{Extended_Pictographic}]{3,50}$/u;
const USERNAME_MAX_LENGTH = 50;

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
      .select("display_name, avatar_url, role, username")
      .eq("user_id", user.id)
      .single();

    const db = dbProfile as { display_name?: string; avatar_url?: string; role?: string; username?: string } | null;
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
      created_at: user.created_at,
      email: user.email ?? "",
      role: db?.role ?? null,
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

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { username, avatar_url } = body as { username?: string; avatar_url?: string };

    const updates: { username?: string; avatar_url?: string; updated_at?: string } = {};

    if (typeof username === "string") {
      const trimmed = username.trim();
      if (!trimmed) {
        return NextResponse.json({ error: "username_required" }, { status: 400 });
      }
      if (trimmed.length > USERNAME_MAX_LENGTH || !USERNAME_REGEX.test(trimmed)) {
        return NextResponse.json({ error: "username_invalid" }, { status: 400 });
      }

      const { data: existing } = await supabase
        .from("ecos_profiles")
        .select("user_id")
        .eq("username", trimmed)
        .neq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ error: "username_taken" }, { status: 409 });
      }
      updates.username = trimmed;
    }

    if (typeof avatar_url === "string") {
      updates.avatar_url = avatar_url || null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true });
    }

    updates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("ecos_profiles")
      .upsert({ user_id: user.id, ...updates }, { onConflict: "user_id" });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "username_taken" }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("api/profile PATCH error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
