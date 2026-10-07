import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api/body-limit";
import { getRequestUser, handleRoute, jsonError, PRIVATE_NO_STORE } from "@/lib/api/route";
import { getUserStats } from "@/lib/queries/users";
import {
  buildProfileView,
  PROFILE_VIEW_COLUMNS,
  type ProfileDbRow,
} from "@/lib/queries/profile";
import { USERNAME_MAX_LENGTH, USERNAME_REGEX } from "@/lib/username";

export const GET = handleRoute("api/profile", async () => {
  const { supabase, user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  // Estadísticas y fila del perfil no dependen una de otra: en paralelo (PERFDB-04).
  const [stats, { data: dbProfile }] = await Promise.all([
    getUserStats(user.id, supabase),
    supabase.from("ecos_profiles").select(PROFILE_VIEW_COLUMNS).eq("user_id", user.id).single(),
  ]);

  const profile = buildProfileView(user, dbProfile as ProfileDbRow | null);
  return NextResponse.json({ profile, stats }, { headers: PRIVATE_NO_STORE });
});

export const PATCH = handleRoute("api/profile PATCH", async (request: NextRequest) => {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const { supabase, user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  if (typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) {
    return jsonError(400, "Invalid payload");
  }
  const { username, avatar_url, show_avatar_in_rankings } = body.data as {
    username?: unknown;
    avatar_url?: unknown;
    show_avatar_in_rankings?: unknown;
  };

  const updates: {
    username?: string;
    avatar_url?: string | null;
    show_avatar_in_rankings?: boolean;
    updated_at?: string;
  } = {};

  if (typeof username === "string") {
    const trimmed = username.trim();
    if (!trimmed) {
      return jsonError(400, "username_required");
    }
    if (trimmed.length > USERNAME_MAX_LENGTH || !USERNAME_REGEX.test(trimmed)) {
      return jsonError(400, "username_invalid");
    }

    const { data: existing } = await supabase
      .from("ecos_profiles")
      .select("user_id")
      .eq("username", trimmed)
      .neq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      return jsonError(409, "username_taken");
    }
    updates.username = trimmed;
  }

  if (typeof avatar_url === "string") {
    updates.avatar_url = avatar_url || null;
  }

  if (typeof show_avatar_in_rankings === "boolean") {
    updates.show_avatar_in_rankings = show_avatar_in_rankings;
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
      return jsonError(409, "username_taken");
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
});
