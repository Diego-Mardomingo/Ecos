import { routing } from "@/i18n/routing";

/**
 * Ruta con prefijo de locale solo si no es el locale por defecto (next-intl as-needed).
 * La raíz en inglés es `/en`, no `/en/`, que costaría una redirección más.
 */
export function localizedPath(locale: string, pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (locale === routing.defaultLocale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * Locale de una ruta interna según su prefijo (`/en/play` → `en`). Sin prefijo, el locale por
 * defecto. Para los sitios que no tienen el locale de la petición, como el callback de OAuth.
 */
export function localeFromPath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0];
  const match = routing.locales.find(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)
  );
  return match ?? routing.defaultLocale;
}
