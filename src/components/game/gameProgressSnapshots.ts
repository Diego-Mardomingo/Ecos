import type { GameOptimistic, SongSnapshot } from "@/lib/hooks/queryTypes";
import type { GameWithSong } from "@/lib/queries/games";
import { calculateScore } from "@/lib/scoring";
import { MAX_ATTEMPTS } from "@/lib/server-attempt";
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

/** Canción del reto tal como la necesitan los parches de caché al terminar. */
export function songSnapshot(game: GameWithSong): SongSnapshot {
  return {
    title: game.ecos_songs.title,
    artist_name: game.ecos_songs.artist_name,
    cover_url: game.ecos_songs.cover_url,
  };
}

/** Payload optimista de un acierto. */
export function wonOptimistic(opts: {
  game: GameWithSong;
  score: number;
  guesses: GuessEntry[];
  correctAttempt: number;
}): GameOptimistic {
  return {
    type: "completion",
    won: true,
    score: opts.score,
    completedProgress: {
      gameDate: opts.game.date,
      guesses: opts.guesses,
      correctAttempt: opts.correctAttempt,
    },
  };
}

/**
 * Payload optimista de un intento que **no** gana la partida: fallar o saltar.
 *
 * Era el mismo objeto escrito dos veces, en la rama de fallo de `handleGuess` y en el botón de
 * saltar. La forma depende solo de si ese intento agota los seis, no de cómo se llegó ahí.
 */
export function nonWinningOptimistic(opts: {
  game: GameWithSong;
  lostNow: boolean;
  guesses: GuessEntry[];
}): GameOptimistic {
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

/**
 * Respuesta del servidor a una jugada, común a `/api/validate-guess` y `/api/skip-attempt` (el
 * salto no trae veredicto: siempre es un fallo).
 */
export interface ServerMoveResult {
  correct?: boolean;
  correctArtist?: boolean;
  correctAlbum?: boolean;
  /** Intento con el que el servidor ha registrado la jugada. */
  attemptNumber?: number;
  totalPoints?: number;
  /** La partida ya estaba cerrada en el servidor: no se ha registrado nada. */
  alreadyFinalized?: boolean;
}

export type MoveConfirmation =
  /**
   * El servidor tiene otra partida distinta de la que cree el cliente (ya estaba cerrada, o ha
   * apuntado la jugada en otro intento porque hay jugadas de otro dispositivo). No se puede
   * deducir de la respuesta: hay que leer el progreso del servidor entero.
   */
  | { kind: "adopt-server" }
  /** Estado de la partida tras la jugada, tal como lo ha dejado el servidor. */
  | {
      kind: "confirmed";
      progress: GameProgress;
      /** La jugada con el veredicto y los aciertos de artista/álbum del servidor. */
      entry: GuessEntry;
      /** El servidor ha decidido otra cosa que el cliente sobre si era la canción. */
      verdictChanged: boolean;
    };

/**
 * Traduce la respuesta del servidor a una jugada al estado en que queda la partida. Es pura: no
 * toca stores ni caché, solo decide.
 *
 * El servidor manda (S-1): cierra la partida si la jugada la decide, y su veredicto y sus
 * aciertos de artista/álbum son los buenos aunque el cliente haya supuesto otra cosa. Con la
 * misma regla en los dos lados (`src/lib/guess-match.ts`) no deberían discrepar, pero si lo
 * hacen, lo que se pinta es lo que ha quedado guardado.
 */
export function confirmMove(opts: {
  game: GameWithSong;
  /** Intentos anteriores a esta jugada. */
  previousGuesses: GuessEntry[];
  /** La jugada tal como la pintó el cliente. */
  entry: GuessEntry;
  /** Puntuación optimista, si el cliente la dio por acertada. */
  optimisticScore: number | null;
  server: ServerMoveResult;
}): MoveConfirmation {
  const { game, entry, server } = opts;
  if (server.alreadyFinalized) return { kind: "adopt-server" };
  if (server.attemptNumber != null && server.attemptNumber !== entry.attemptNumber) {
    return { kind: "adopt-server" };
  }

  const confirmedEntry: GuessEntry = {
    ...entry,
    correct: server.correct ?? entry.correct,
    correctArtist: server.correctArtist ?? entry.correctArtist,
    correctAlbum: server.correctAlbum ?? entry.correctAlbum,
  };
  const guesses = [...opts.previousGuesses, confirmedEntry];
  const attempt = entry.attemptNumber;

  let progress: GameProgress;
  if (confirmedEntry.correct) {
    const score =
      server.totalPoints ?? opts.optimisticScore ?? calculateScore(attempt, 0).totalPoints;
    progress = wonProgress({ game, score, guesses, correctAttempt: attempt });
  } else if (attempt >= MAX_ATTEMPTS) {
    progress = lostProgress({ game, guesses });
  } else {
    progress = playingProgress({ game, guesses });
  }

  return {
    kind: "confirmed",
    progress,
    entry: confirmedEntry,
    verdictChanged: confirmedEntry.correct !== entry.correct,
  };
}

