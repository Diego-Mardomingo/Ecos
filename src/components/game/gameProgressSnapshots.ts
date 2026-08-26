import type { GameWithSong } from "@/lib/queries/games";
import type { GameProgress } from "@/lib/store/gameProgressStore";
import type { GuessEntry } from "@/lib/store/gameStore";

/**
 * Constructores del snapshot que se guarda en `gameProgressStore`.
 *
 * Existen porque `saveProgress({...})` estaba escrito a mano en ocho sitios de `GameClient`, con
 * el mismo objeto repetido entre las ramas de invitado y autenticado y entre adivinar y saltar. Y
 * la duplicación ya había costado un fallo: la derrota del invitado al **saltar** guardaba
 * `score: null` mientras la de fallar guardaba `score: 0`.
 *
 * Eso no es cosmético. `deriveHomeDayState` decide si un día está completado con
 * `played && displayScore !== null`, así que con `null` la home mostraba como «sin jugar» un día
 * que el usuario había perdido. Con un único constructor de derrota, ese caso no puede volver a
 * divergir.
 */

/** Campos de la canción que se guardan al terminar, para poder pintar el resultado sin red. */
function songFields(game: GameWithSong) {
  return {
    title: game.ecos_songs.title,
    artist_name: game.ecos_songs.artist_name,
    cover_url: game.ecos_songs.cover_url ?? undefined,
  };
}

/** Partida acertada. `score` puede ser el optimista o el que confirme el servidor. */
export function wonProgress(opts: {
  game: GameWithSong;
  score: number;
  guesses: GuessEntry[];
  correctAttempt: number;
}): GameProgress {
  return {
    gameId: opts.game.id,
    gameDate: opts.game.date,
    played: true,
    won: true,
    score: opts.score,
    ...songFields(opts.game),
    guesses: opts.guesses,
    phase: "won",
    correctAttempt: opts.correctAttempt,
  };
}

/**
 * Partida perdida.
 *
 * `score: 0` y no `null`: una derrota es una partida jugada. Con `null`, `deriveHomeDayState` la
 * cuenta como no completada (`completed = played && displayScore !== null`) y el día aparece como
 * pendiente en la home.
 */
export function lostProgress(opts: {
  game: GameWithSong;
  guesses: GuessEntry[];
}): GameProgress {
  return {
    gameId: opts.game.id,
    gameDate: opts.game.date,
    played: true,
    won: false,
    score: 0,
    ...songFields(opts.game),
    guesses: opts.guesses,
    phase: "lost",
  };
}

/**
 * Partida en curso. Sin los campos de la canción a propósito: mientras no esté resuelta no se
 * guarda el título ni la carátula en localStorage, que es de donde tiraría un invitado.
 */
export function playingProgress(opts: {
  game: GameWithSong;
  guesses: GuessEntry[];
}): GameProgress {
  return {
    gameId: opts.game.id,
    gameDate: opts.game.date,
    played: false,
    won: false,
    score: null,
    guesses: opts.guesses,
    phase: "playing",
  };
}

/**
 * Payload optimista de un intento que **no** gana la partida: fallar o saltar.
 *
 * Era el mismo objeto escrito dos veces, en la rama de fallo de `handleGuess` y en el botón de
 * saltar. La forma depende solo de si ese intento agota los seis, no de cómo se llegó ahí.
 */
export type NonWinningOptimistic =
  | {
      type: "completion";
      won: false;
      score: 0;
      completedProgress: { gameDate: string; guesses: GuessEntry[] };
    }
  | {
      type: "inProgress";
      inProgress: {
        gameId: string;
        gameDate: string;
        guesses: GuessEntry[];
        phase: "playing";
      };
    };

export function nonWinningOptimistic(opts: {
  game: GameWithSong;
  lostNow: boolean;
  guesses: GuessEntry[];
}): NonWinningOptimistic {
  if (opts.lostNow) {
    return {
      type: "completion",
      won: false,
      score: 0,
      completedProgress: { gameDate: opts.game.date, guesses: opts.guesses },
    };
  }
  return {
    type: "inProgress",
    inProgress: {
      gameId: opts.game.id,
      gameDate: opts.game.date,
      guesses: opts.guesses,
      phase: "playing",
    },
  };
}
