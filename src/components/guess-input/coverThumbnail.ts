/**
 * Miniatura de 64 px de una carátula de Spotify (PERF-09).
 *
 * El catálogo guarda la variante de 300 px (`ab67616d00001e02…`, unos 30–45 KB) y el buscador la
 * pinta a 40 px: con una búsqueda corriente bajaban más de 150 KB de imágenes. El CDN de Spotify
 * sirve la misma imagen a 64 px cambiando el código de tamaño del id (`ab67616d00004851…`, unos
 * 3 KB), en los mismos hosts (`image-cdn-*.spotifycdn.com`, `i.scdn.co`).
 *
 * Cualquier URL que no tenga esa forma se devuelve tal cual.
 */
const SPOTIFY_COVER_300 = /^(https:\/\/(?:i\.scdn\.co|[\w-]+\.spotifycdn\.com)\/image\/ab67616d)00001e02(?=[0-9a-f]+$)/;

export function coverThumbnailUrl(coverUrl: string): string {
  return coverUrl.replace(SPOTIFY_COVER_300, "$100004851");
}
