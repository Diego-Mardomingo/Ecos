/**
 * Cómo se muestra el nombre de una persona: iniciales del avatar y nombre visible en el ranking.
 *
 * Antes cada pantalla cortaba con `.slice(0, 2)`, que cuenta unidades UTF-16: el nombre de usuario
 * admite emojis (`USERNAME_REGEX`), y `"x🎧".slice(0, 2)` deja medio emoji suelto (DUP-20).
 */

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Primeros `count` caracteres visibles de `text` (un emoji, aunque sea compuesto, cuenta como uno). */
function firstGraphemes(text: string, count: number): string {
  const pieces = graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), (s) => s.segment)
    : Array.from(text);
  return pieces.slice(0, count).join("");
}

/** Dos primeras letras del nombre en mayúsculas, o `?` si no hay nombre. */
export function avatarInitials(name: string | null | undefined): string {
  return firstGraphemes((name ?? "").trim(), 2).toUpperCase() || "?";
}

/**
 * Nombre que se enseña en el ranking: el recortado, o `fallback` si está vacío o es `admin`
 * (nombre de cuenta interno que no debe verse).
 */
export function rankingDisplayName(
  name: string | null | undefined,
  fallback: string
): string {
  const trimmed = name?.trim();
  if (trimmed && trimmed.toLowerCase() !== "admin") return trimmed;
  return fallback;
}
