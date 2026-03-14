import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { CompleteProfileClient } from "@/components/profile/CompleteProfileClient";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Completa tu perfil",
};

export default async function CompleteProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: dbProfile } = await supabase
    .from("ecos_profiles")
    .select("username")
    .eq("user_id", user.id)
    .single();

  if (dbProfile?.username) {
    redirect("/profile");
  }

  return <CompleteProfileClient />;
}
