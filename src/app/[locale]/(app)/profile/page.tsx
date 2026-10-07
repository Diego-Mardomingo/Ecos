import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getUserStats } from "@/lib/queries/users";
import { buildProfileView, PROFILE_VIEW_COLUMNS, summarizeNotifications, type ProfileDbRow } from "@/lib/queries/profile";
import { ProfileClient } from "@/components/profile/ProfileClient";
import { redirectToLoginWithReturn } from "@/lib/auth/redirectToLogin";
import { localizedPath } from "@/lib/i18n/localizedPath";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "profile" });
  return { title: t("title") };
}

export default async function ProfilePage() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirectToLoginWithReturn(locale, localizedPath(locale, "/profile"));
  }

  const [stats, { data: dbProfile }, { data: pushSubs }] = await Promise.all([
    getUserStats(user.id, supabase),
    supabase
      .from("ecos_profiles")
      .select(
        "display_name, avatar_url, role, username, show_avatar_in_rankings, notifications_modal_dismiss_count"
      )
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("ecos_push_subscriptions")
      .select("enabled")
      .eq("user_id", user.id),
  ]);

  const db = dbProfile as ProfileDbRow | null;
  const profile = buildProfileView(user, db);
  const notifications = summarizeNotifications(pushSubs, db?.notifications_modal_dismiss_count);

  return (
    <ProfileClient
      initialData={{
        profile,
        stats: stats ?? null,
        notifications,
      }}
    />
  );
}

