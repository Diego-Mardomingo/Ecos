import { NextResponse } from "next/server";
import { getRequestUser, handleRoute, jsonError, PRIVATE_NO_STORE } from "@/lib/api/route";
import {
  buildProfileView,
  PROFILE_VIEW_COLUMNS,
  type ProfileDbRow,
} from "@/lib/queries/profile";

export const GET = handleRoute("api/profile/core", async () => {
  const { supabase, user } = await getRequestUser();
  if (!user) return jsonError(401, "Unauthorized");

  const { data: dbProfile } = await supabase
    .from("ecos_profiles")
    .select(PROFILE_VIEW_COLUMNS)
    .eq("user_id", user.id)
    .single();

  const profile = buildProfileView(user, dbProfile as ProfileDbRow | null);
  return NextResponse.json({ profile, userId: user.id }, { headers: PRIVATE_NO_STORE });
});
