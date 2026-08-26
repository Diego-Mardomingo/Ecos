import { routing } from "./routing";

/**
 * Helpers de rutas con prefijo de locale, derivados de `routing.locales`.
 *
 * Existen porque el patrón estaba copiado en seis sitios como `/^\/(es|en)/`, con los locales
 * escritos a mano. Además de duplicar, ese regex tiene un fallo: casa el prefijo sin exigir que
 * termine el segmento, así que se come el principio de cualquier ruta que empiece por `es` o `en`
 * — `/entrar` quedaba en `trar` y `/especial` en `pecial`. Hoy no hay ninguna ruta así, pero es
 * una trampa esperando a que alguien añada una.
 *
 * Aquí la comparación es por segmento completo, que es como ya lo hacía `src/proxy.ts`.
 */
const LOCALE_SEGMENTS = routing.locales.map((locale) => `/${locale}`);

/** Quita el prefijo de locale de un pathname. `/en/play` → `/play`, `/en` → `/`. */
export function stripLocalePrefix(pathname: string): string {
  for (const segment of LOCALE_SEGMENTS) {
    if (pathname === segment) return "/";
    if (pathname.startsWith(`${segment}/`)) {
      return pathname.slice(segment.length) || "/";
    }
  }
  return pathname || "/";
}

/**
 * Comprueba si un pathname corresponde a una ruta base, ignorando el prefijo de locale y sin
 * confundir `/admin` con `/songs/admin-tips`: la coincidencia es por segmento.
 */
export function matchesLocalizedRoute(pathname: string, base: string): boolean {
  const path = stripLocalePrefix(pathname);
  return path === base || path.startsWith(`${base}/`);
}
