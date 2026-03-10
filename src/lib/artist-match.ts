/**
 * Comparación robusta de nombres de artistas para "correct artist".
 * Maneja acentos, varios artistas, formatos de colaboración.
 */
function normalizeForCompare(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
  );
}

const ARTIST_SEPARATORS =
  /[,;&]|\s+and\s+|\s+y\s+|\s+con\s+|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+vs\.?\s+/i;

function splitArtists(name: string): string[] {
  return name
    .split(ARTIST_SEPARATORS)
    .map((p) => normalizeForCompare(p.trim()))
    .filter((p) => p.length > 0);
}

/**
 * Comprueba si dos nombres de artista representan al mismo artista o si hay solapamiento.
 * Ejemplos que devuelven true:
 * - "Bad Bunny" vs "Bad Bunny, Tainy"
 * - "Beyoncé" vs "Beyonce"
 * - "Daft Punk" vs "Daft Punk"
 */
export function artistsMatch(guess: string, correct: string): boolean {
  if (!guess?.trim() || !correct?.trim()) return false;

  const ng = normalizeForCompare(guess);
  const nc = normalizeForCompare(correct);

  if (ng === nc) return true;
  if (ng.includes(nc) || nc.includes(ng)) return true;

  const partsGuess = splitArtists(guess);
  const partsCorrect = splitArtists(correct);

  return partsGuess.some((pg) =>
    partsCorrect.some((pc) => pg === pc || pg.includes(pc) || pc.includes(pg))
  );
}
