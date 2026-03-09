import { createClient } from "@/lib/supabase/server";
import { getUserStats } from "@/lib/queries/users";
import { ProfileClient } from "@/components/profile/ProfileClient";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [stats, { data: dbProfile }] = await Promise.all([
    getUserStats(user.id),
    supabase
      .from("ecos_profiles")
      .select("display_name, avatar_url, role")
      .eq("user_id", user.id)
      .single(),
  ]);

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

  return <ProfileClient profile={profile} stats={stats} />;
}
