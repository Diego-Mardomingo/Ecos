import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserStats } from "@/lib/queries/users";
import { ProfileClient } from "@/components/profile/ProfileClient";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Perfil",
};

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
      .select("display_name, avatar_url, role, username")
      .eq("user_id", user.id)
      .single(),
  ]);

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

  return (
    <ProfileClient
      initialData={{
        profile,
        stats: stats ?? null,
      }}
    />
  );
}
