import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CompleteProfileClient } from "@/components/profile/CompleteProfileClient";
import { redirectToLoginWithReturn } from "@/lib/auth/redirectToLogin";
import { localizedPath } from "@/lib/i18n/localizedPath";

export const metadata: Metadata = {
  title: "Completa tu perfil",
};

export default async function CompleteProfilePage() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirectToLoginWithReturn(locale, localizedPath(locale, "/profile/complete"));
  }

  const { data: dbProfile } = await supabase
    .from("ecos_profiles")
    .select("username")
    .eq("user_id", user.id)
    .single();

  if (dbProfile?.username) {
    redirect(localizedPath(locale, "/profile"));
  }

  return <CompleteProfileClient />;
}
