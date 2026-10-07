import { LoginClient } from "@/components/auth/LoginClient";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getSafeRedirectTarget } from "@/lib/auth/safeRedirectPath";
import { resolvePostLoginPath } from "@/lib/auth/postLoginPath";
import { localizedPath } from "@/lib/i18n/localizedPath";

type Props = {
  searchParams: Promise<{ redirect?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const params = await searchParams;
  const target = getSafeRedirectTarget(params.redirect) ?? localizedPath(locale, "/");

  // Ya hay sesión: se llega aquí con un enlace de "Entrar" estando dentro, o al recargar la
  // página después de One Tap. En los dos casos, al destino (o antes al onboarding).
  if (user) {
    redirect(await resolvePostLoginPath(supabase, user.id, target, locale));
  }

  return <LoginClient redirectTo={target} />;
}
