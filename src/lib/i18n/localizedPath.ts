import { routing } from "@/i18n/routing";

/** Ruta con prefijo de locale solo si no es el locale por defecto (next-intl as-needed). */
export function localizedPath(locale: string, pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (locale === routing.defaultLocale) return path;
  return `/${locale}${path}`;
}
