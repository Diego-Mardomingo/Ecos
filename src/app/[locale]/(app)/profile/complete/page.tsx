import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CompleteProfileClient } from "@/components/profile/CompleteProfileClient";
import { redirectToLoginWithReturn } from "@/lib/auth/redirectToLogin";
import { getSafeRedirectTarget } from "@/lib/auth/safeRedirectPath";
import { localizedPath } from "@/lib/i18n/localizedPath";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "profile" });
  return { title: t("completeProfile.title") };
}

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] }>;
}) {
  const locale = await getLocale();
  const { redirect: redirectParam } = await searchParams;
  // Destino tras elegir nombre: se conserva si ya lo tiene y al pasar por el login (C-1).
  const target = getSafeRedirectTarget(
    Array.isArray(redirectParam) ? redirectParam[0] : redirectParam
  );
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const here = localizedPath(locale, "/profile/complete");
    redirectToLoginWithReturn(
      locale,
      target ? `${here}?redirect=${encodeURIComponent(target)}` : here
    );
  }

  const { data: dbProfile } = await supabase
    .from("ecos_profiles")
    .select("username")
    .eq("user_id", user.id)
    .single();

  if (dbProfile?.username) {
    redirect(target ?? localizedPath(locale, "/profile"));
  }

  return <CompleteProfileClient />;
}
