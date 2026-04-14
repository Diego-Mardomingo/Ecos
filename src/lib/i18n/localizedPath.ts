import { routing } from "@/i18n/routing";

/** Ruta con prefijo de locale solo si no es el locale por defecto (next-intl as-needed). */
export function localizedPath(locale: string, pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (locale === routing.defaultLocale) return path;
  return `/${locale}${path}`;
}

/**
 * Solo rutas internas relativas (mismo origen). Evita redirecciones abiertas desde ?redirect=.
 */
export function safeRelativeInternalPath(
  raw: string | null | undefined,
  fallback: string
): string {
  if (raw == null || typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (/[\r\n\0]/.test(trimmed)) return fallback;
  return trimmed;
}
