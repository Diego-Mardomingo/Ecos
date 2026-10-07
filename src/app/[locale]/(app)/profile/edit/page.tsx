import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { buildProfileView, type ProfileDbRow } from "@/lib/queries/profile";
import { EditProfileClient } from "@/components/profile/EditProfileClient";
import { redirectToLoginWithReturn } from "@/lib/auth/redirectToLogin";
import { localizedPath } from "@/lib/i18n/localizedPath";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "profile" });
  return { title: t("editProfilePage.title") };
}

export default async function EditProfilePage() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirectToLoginWithReturn(locale, localizedPath(locale, "/profile/edit"));
  }

  const { data: dbProfile } = await supabase
    .from("ecos_profiles")
    .select("display_name, avatar_url, username, show_avatar_in_rankings")
    .eq("user_id", user.id)
    .single();

  const db = dbProfile as ProfileDbRow | null;
  const { display_name, avatar_url, show_avatar_in_rankings } = buildProfileView(user, db);
  const profile = {
    id: user.id,
    display_name,
    avatar_url,
    username: db?.username ?? null,
    show_avatar_in_rankings,
  };

  return <EditProfileClient profile={profile} />;
}
