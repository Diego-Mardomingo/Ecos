import { artistsMatch, normalizeForCompare } from "@/lib/artist-match";

/**
 * Regla única de «has acertado». La usan el servidor (`/api/validate-guess`) y la comprobación
 * local del invitado (`GameClient.tsx`): si cambia aquí, cambia en los dos sitios a la vez.
 *
 * Es un módulo puro, sin dependencias de servidor ni de navegador.
 *
 * Cuenta como acierto:
 * - elegir exactamente la canción del reto (mismo id), o
 * - elegir una canción cuyo **título base** sea igual al del reto. El título base es el título
 *   normalizado (minúsculas, sin acentos, sin puntuación ni espacios de sobra) y sin los sufijos
 *   de versión que añade Spotify: todo lo que va entre paréntesis o corchetes y todo lo que sigue
 *   a « - » («(feat. …)», «- Remastered 2011», «- Versión 2001», «- En directo», «(Live)»…).
 *
 * Así se aceptan las versiones de la misma canción con otro intérprete o en otra edición («No
 * Puedo Vivir Sin Ti» de Los Ronaldos para la de El Canto del Loco, «Amores extraños - Versión
 * 2001» para «Amores extraños»), que es lo que decidió Diego (auditoría oct. 2026, D1).
 *
 * Lo que ya **no** cuenta es que el texto *contenga* el título: la regla anterior del servidor
 * daba por buena «Se Que Volveras» para el reto «Volvera», y «Así» validaba 18 canciones.
 */

/** Lo mínimo que hace falta de una canción para compararla. */
export interface GuessMatchSong {
  id: string;
  title: string;
  artist_name: string;
  album_title?: string | null;
}

export interface GuessEvaluation {
  correct: boolean;
  correctArtist: boolean;
  correctAlbum: boolean;
}

/** Comillas y apóstrofos: se quitan sin dejar hueco («Pa' Verte» = «Pa Verte»). */
const QUOTES = /['’‘`´"“”«»]/g;

/**
 * Puntuación y símbolos ASCII y Latin-1 (incluye «¿» y «¡») y la puntuación general de Unicode
 * (rayas, puntos suspensivos…). Se cambian por un espacio. No se usa `\p{…}` porque el target
 * del proyecto es ES2017.
 */
const PUNCTUATION = /[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00bf\u00d7\u00f7\u2000-\u206f]/g;

/** Paréntesis y corchetes con su contenido, en cualquier posición. */
const BRACKETED = /\([^()]*\)|\[[^\[\]]*\]/g;

/** Primer « - » (o raya) rodeado de espacios: lo que sigue es la versión o edición. */
const VERSION_SEPARATOR = /\s[-–—]\s/;

function normalizeTitleText(s: string): string {
  return normalizeForCompare(s.replace(QUOTES, ""))
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clave de comparación de un título. Si quitar los sufijos deja la clave vacía (títulos como
 * «+ (MÁS)»), se usa el título completo normalizado.
 */
export function titleMatchKey(title: string): string {
  const withoutBrackets = title.replace(BRACKETED, " ");
  const base = withoutBrackets.split(VERSION_SEPARATOR)[0] ?? "";
  const key = normalizeTitleText(base);
  return key || normalizeTitleText(title);
}

export function titlesMatch(guessTitle: string, targetTitle: string): boolean {
  const a = titleMatchKey(guessTitle);
  const b = titleMatchKey(targetTitle);
  return a.length > 0 && a === b;
}

/** Evalúa una respuesta (la canción elegida en el buscador) contra la canción del reto. */
export function evaluateGuess(guess: GuessMatchSong, target: GuessMatchSong): GuessEvaluation {
  const correct = String(guess.id) === String(target.id) || titlesMatch(guess.title, target.title);
  const correctArtist = artistsMatch(guess.artist_name, target.artist_name);
  const correctAlbum =
    guess.album_title != null &&
    target.album_title != null &&
    guess.album_title.trim() !== "" &&
    normalizeForCompare(guess.album_title) === normalizeForCompare(target.album_title);
  return { correct, correctArtist, correctAlbum };
}
