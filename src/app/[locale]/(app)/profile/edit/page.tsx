import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { EditProfileClient } from "@/components/profile/EditProfileClient";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Editar perfil",
};

export default async function EditProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: dbProfile } = await supabase
    .from("ecos_profiles")
    .select("display_name, avatar_url, username")
    .eq("user_id", user.id)
    .single();

  const db = dbProfile as { display_name?: string; avatar_url?: string; username?: string } | null;
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
    username: db?.username ?? null,
  };

  return <EditProfileClient profile={profile} />;
}
