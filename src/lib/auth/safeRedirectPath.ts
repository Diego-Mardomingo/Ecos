/**
 * Saneador único de destinos de redirección (`?redirect=` del login y del onboarding, `?next=`
 * del callback de OAuth). Solo admite rutas internas del mismo origen.
 *
 * Antes había tres validadores distintos y cada uno dejaba pasar algo: `/\evil.com` y
 * `/<TAB>/evil.com` salían del dominio (SEC-04). El parser de URL del navegador quita
 * tabuladores y saltos de línea y trata `\` como `/`, así que cualquiera de los dos acaba siendo
 * `//evil.com`, que es una URL a otro host. Por eso aquí no se mira la cadena a ojo: se resuelve
 * contra un origen ficticio y se exige que el origen no cambie.
 */

const FAKE_ORIGIN = "http://ecos.invalid";

/** Barra invertida o caracteres de control, tal cual o codificados (`%5C`, `%09`, `%0A`…). */
const DANGEROUS_CHARS = /[\\\u0000-\u001f\u007f]|%(?:5c|7f|[01][0-9a-f])/i;

/**
 * Devuelve la ruta normalizada (`pathname + search + hash`) si es interna, o `null` si no lo es.
 */
export function getSafeRedirectTarget(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  if (DANGEROUS_CHARS.test(candidate)) return null;

  let url: URL;
  try {
    url = new URL(candidate, FAKE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== FAKE_ORIGIN) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}
