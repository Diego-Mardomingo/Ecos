const DEFAULT_SITE_URL = "https://ecosgame.vercel.app";

/**
 * Base de las URL absolutas del sitio (metadataBase, robots, sitemap…). `NEXT_PUBLIC_SITE_URL`
 * permite apuntar a otro dominio sin tocar código; si falta, no se puede leer o no es https, se usa
 * el de producción en vez de lanzar al generar los metadatos.
 */
export function getSiteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:") return url;
    } catch {
      // Valor mal formado: se ignora.
    }
  }
  return new URL(DEFAULT_SITE_URL);
}
