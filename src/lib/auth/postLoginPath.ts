import { matchesLocalizedRoute } from "@/i18n/locale-path";
import { localizedPath } from "@/lib/i18n/localizedPath";
import type { createClient } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Adónde mandar a alguien que acaba de iniciar sesión.
 *
 * Si todavía no ha elegido nombre de usuario, primero al onboarding y después al destino. Sin
 * esto el onboarding solo saltaba al entrar en `/profile`, y quien no pasaba por ahí salía en el
 * ranking con su nombre real de Google (UX-08). Lo usan los dos caminos de login: el callback de
 * OAuth y la página de login (One Tap recarga esa página al terminar).
 *
 * `target` tiene que venir ya saneado con `getSafeRedirectTarget()`.
 */
export async function resolvePostLoginPath(
  supabase: ServerSupabase,
  userId: string,
  target: string,
  locale: string
): Promise<string> {
  const targetPath = target.split(/[?#]/, 1)[0];
  // Volver a /login con sesión ya iniciada sería un bucle de redirecciones (`?redirect=/login`).
  if (matchesLocalizedRoute(targetPath, "/login")) {
    return resolvePostLoginPath(supabase, userId, localizedPath(locale, "/"), locale);
  }
  if (matchesLocalizedRoute(targetPath, "/profile/complete")) return target;

  const { data: profile, error } = await supabase
    .from("ecos_profiles")
    .select("username")
    .eq("user_id", userId)
    .maybeSingle();

  // Si la lectura falla no se bloquea la entrada: el proxy vuelve a pedir el nombre en /profile.
  if (error) return target;
  if (profile?.username?.trim()) return target;

  return `${localizedPath(locale, "/profile/complete")}?redirect=${encodeURIComponent(target)}`;
}
