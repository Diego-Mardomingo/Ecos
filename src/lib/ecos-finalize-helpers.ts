import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateScore } from "@/lib/scoring";
import { getEffectiveGameDate, getMadridYesterdayDateString, toDateKey } from "@/lib/date-utils";
import { unwrapToOne } from "@/lib/supabase/relations";
import { MAX_ATTEMPTS, resolveServerAttempt } from "@/lib/server-attempt";
import type { GuessEvaluation, GuessMatchSong } from "@/lib/guess-match";
import { notifyRankingChanged } from "@/lib/realtime/broadcast-ranking";

/**
 * Camino único de servidor para registrar una jugada y cerrar la partida.
 *
 * Lo usan `/api/validate-guess`, `/api/skip-attempt` y la autorreparación de
 * `/api/game-progress`. Antes cada uno tenía su copia (con divergencias: el salto leía y escribía
 * con el cliente RLS y podía añadir filas a una partida ya ganada). Todo va con el cliente de
 * service role que le pasa la ruta, así que **la ruta es responsable de haber comprobado la
 * sesión** antes de llamar aquí.
 *
 * Viajes a la BD por jugada: (sesión ∥ juego) → (puntuación ∥ intentos ∥ leaderboard) → escritura.
 */

export interface LeaderboardSnapshot {
  streak: number | null;
  last_played: string | null;
}

export interface ScoreResult {
  basePoints: number;
  streakBonus: number;
  totalPoints: number;
}

/**
 * Racha y puntuación de una partida que se cierra. Solo las partidas del día tocan la racha; las
 * de días pasados puntúan pero la dejan como está.
 */
export function computeFinalizeParams(opts: {
  gameDate: string;
  isCorrect: boolean;
  attemptNumber: number;
  leaderboard: LeaderboardSnapshot | null;
}): {
  newStreak: number;
  updateStreak: boolean;
  scoreResult: ScoreResult;
} {
  const todayMadrid = getEffectiveGameDate();
  const isTodaysGame = opts.gameDate === todayMadrid;

  let newStreak: number;
  const updateStreak = isTodaysGame;

  if (isTodaysGame) {
    if (opts.isCorrect) {
      const lastPlayedKey = toDateKey(opts.leaderboard?.last_played ?? null);
      const yesterdayStr = getMadridYesterdayDateString(todayMadrid);

      if (lastPlayedKey === todayMadrid) {
        newStreak = opts.leaderboard?.streak ?? 0;
      } else if (lastPlayedKey === yesterdayStr) {
        newStreak = (opts.leaderboard?.streak ?? 0) + 1;
      } else {
        newStreak = 1;
      }
    } else {
      newStreak = 0;
    }
  } else {
    newStreak = opts.leaderboard?.streak ?? 0;
  }

  const scoreResult = opts.isCorrect
    ? calculateScore(opts.attemptNumber, 1)
    : { basePoints: 0, streakBonus: 0, totalPoints: 0 };

  return { newStreak, updateStreak, scoreResult };
}

// ---------------------------------------------------------------------------------------------
// Juego
// ---------------------------------------------------------------------------------------------

export interface PlayableGame {
  id: string;
  date: string;
  song: GuessMatchSong | null;
}

export type LoadGameResult =
  | { ok: true; game: PlayableGame }
  | { ok: false; status: 404 | 403; error: string };

/**
 * Lee el juego y comprueba que se puede jugar: existe y no es de una fecha futura
 * (`select-daily-game.py` crea los juegos con antelación). No depende del usuario, así que la
 * ruta puede lanzarlo a la vez que `getUser()`.
 */
export async function loadPlayableGame(
  svc: SupabaseClient,
  gameId: string
): Promise<LoadGameResult> {
  const { data, error } = await svc
    .from("ecos_games")
    .select("id, date, ecos_songs(id, title, artist_name, album_title)")
    .eq("id", gameId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, status: 404, error: "Game not found" };

  const date = (data as { date?: string | null }).date ?? "";
  if (!date || date > getEffectiveGameDate()) {
    return { ok: false, status: 403, error: "Game not available" };
  }

  return {
    ok: true,
    game: {
      id: data.id as string,
      date,
      song: unwrapToOne(data.ecos_songs as GuessMatchSong | GuessMatchSong[] | null),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Estado de la partida del jugador
// ---------------------------------------------------------------------------------------------

export interface StoredGuess {
  attempt_number: number;
  guess_text: string;
  correct: boolean;
}

export interface PlayerGameState {
  score: { points: number; guesses_used: number; correct: boolean } | null;
  guesses: StoredGuess[];
  leaderboard: LeaderboardSnapshot | null;
}

/**
 * Puntuación, intentos y fila del leaderboard en un solo viaje. La del leaderboard solo hace
 * falta al cerrar, pero cuesta casi nada y ahorra un viaje en serie justo cuando más importa.
 */
export async function loadPlayerGameState(
  svc: SupabaseClient,
  userId: string,
  gameId: string
): Promise<PlayerGameState> {
  const [scoreRes, guessesRes, leaderboardRes] = await Promise.all([
    svc
      .from("ecos_scores")
      .select("points, guesses_used, correct")
      .eq("user_id", userId)
      .eq("game_id", gameId)
      .maybeSingle(),
    svc
      .from("ecos_guesses")
      .select("attempt_number, guess_text, correct")
      .eq("user_id", userId)
      .eq("game_id", gameId),
    svc
      .from("ecos_leaderboard")
      .select("streak, last_played")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  // Sin estos datos no se puede decidir el número de intento ni si la partida está cerrada:
  // mejor un 500 que registrar la jugada a ciegas.
  if (scoreRes.error) throw scoreRes.error;
  if (guessesRes.error) throw guessesRes.error;
  if (leaderboardRes.error) throw leaderboardRes.error;

  return {
    score: scoreRes.data,
    guesses: guessesRes.data ?? [],
    leaderboard: leaderboardRes.data,
  };
}

/**
 * Si los intentos guardados ya deciden la partida (hay uno correcto o se llegó al sexto), devuelve
 * cómo acabó. Con puntuación guardada esto no hace falta; sirve para las partidas que quedaron con
 * los intentos escritos y sin `ecos_scores`.
 */
export function decisiveOutcomeFromGuesses(
  guesses: { correct: boolean; attempt_number: number }[]
): { won: boolean; attemptNumber: number } | null {
  if (guesses.length === 0) return null;

  const firstCorrect = guesses
    .filter((g) => g.correct)
    .reduce<number | null>(
      (min, g) => (min == null || g.attempt_number < min ? g.attempt_number : min),
      null
    );
  if (firstCorrect != null) return { won: true, attemptNumber: firstCorrect };

  const maxAttempt = Math.max(...guesses.map((g) => g.attempt_number));
  if (maxAttempt >= MAX_ATTEMPTS) return { won: false, attemptNumber: MAX_ATTEMPTS };

  return null;
}

// ---------------------------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------------------------

/** Cierra una partida cuyos intentos ya están en la BD (sin escribir intento nuevo). */
async function finalizeFromStoredGuesses(
  svc: SupabaseClient,
  opts: {
    userId: string;
    gameId: string;
    gameDate: string;
    outcome: { won: boolean; attemptNumber: number };
    leaderboard: LeaderboardSnapshot | null;
  }
): Promise<{ error: unknown; scoreResult: ScoreResult }> {
  const { newStreak, updateStreak, scoreResult } = computeFinalizeParams({
    gameDate: opts.gameDate,
    isCorrect: opts.outcome.won,
    attemptNumber: opts.outcome.attemptNumber,
    leaderboard: opts.leaderboard,
  });

  const { error } = await svc.rpc("ecos_finalize_game_score", {
    p_user_id: opts.userId,
    p_game_id: opts.gameId,
    p_points: scoreResult.totalPoints,
    p_guesses_used: opts.outcome.attemptNumber,
    p_correct: opts.outcome.won,
    p_won: opts.outcome.won,
    p_streak: newStreak,
    p_update_streak: updateStreak,
  });

  return { error, scoreResult };
}

export interface AttemptInput {
  userId: string;
  gameId: string;
  gameDate: string;
  /** Intento que dice el cliente; el definitivo lo decide `resolveServerAttempt`. */
  clientAttempt: number;
  /** Texto que se guarda en `ecos_guesses.guess_text` («título - artista» o `skipped`). */
  guessText: string;
  evaluation: GuessEvaluation;
}

export type AttemptOutcome =
  /** La partida ya estaba cerrada: no se ha escrito nada nuevo ni se ha vuelto a puntuar. */
  | { kind: "already-finalized"; attemptNumber: number; totalPoints: number }
  /** Intento intermedio guardado; la partida sigue abierta. */
  | { kind: "recorded"; attemptNumber: number }
  /** Intento guardado y partida cerrada (acierto o sexto intento) en la misma transacción. */
  | { kind: "finalized"; attemptNumber: number; scoreResult: ScoreResult }
  | { kind: "error"; message: string; cause: unknown };

/**
 * Registra una jugada (intento o salto) y cierra la partida si la decide.
 *
 * - Partida con puntuación: no escribe nada (un salto o un intento tras ganar ya no añaden filas).
 * - Partida decidida en `ecos_guesses` pero sin puntuación: la cierra con lo que hay y no añade el
 *   intento nuevo.
 * - Si la jugada decide la partida, intento y puntuación van en una sola RPC
 *   (`ecos_guess_and_finalize_score`); si no, un upsert idempotente del intento.
 *
 * El servidor cierra siempre que la jugada es decisiva, diga lo que diga el cliente: así no quedan
 * partidas con un intento correcto y sin puntuar a la espera de la autorreparación.
 */
export async function submitAttempt(
  svc: SupabaseClient,
  input: AttemptInput
): Promise<AttemptOutcome> {
  const { userId, gameId, gameDate, guessText, evaluation } = input;
  const state = await loadPlayerGameState(svc, userId, gameId);

  if (state.score) {
    return {
      kind: "already-finalized",
      attemptNumber: state.score.guesses_used,
      totalPoints: state.score.points ?? 0,
    };
  }

  const stored = decisiveOutcomeFromGuesses(state.guesses);
  if (stored) {
    const { error, scoreResult } = await finalizeFromStoredGuesses(svc, {
      userId,
      gameId,
      gameDate,
      outcome: stored,
      leaderboard: state.leaderboard,
    });
    if (error) return { kind: "error", message: "Failed to save score", cause: error };
    return {
      kind: "already-finalized",
      attemptNumber: stored.attemptNumber,
      totalPoints: scoreResult.totalPoints,
    };
  }

  const attemptNumber = resolveServerAttempt(state.guesses, input.clientAttempt, guessText);
  const decisive = evaluation.correct || attemptNumber >= MAX_ATTEMPTS;

  if (!decisive) {
    const { error } = await svc.from("ecos_guesses").upsert(
      {
        user_id: userId,
        game_id: gameId,
        attempt_number: attemptNumber,
        guess_text: guessText,
        correct: false,
        correct_artist: evaluation.correctArtist,
        correct_album: evaluation.correctAlbum,
      },
      { onConflict: "user_id,game_id,attempt_number" }
    );
    if (error) return { kind: "error", message: "Failed to save guess", cause: error };
    return { kind: "recorded", attemptNumber };
  }

  const { newStreak, updateStreak, scoreResult } = computeFinalizeParams({
    gameDate,
    isCorrect: evaluation.correct,
    attemptNumber,
    leaderboard: state.leaderboard,
  });

  const { error } = await svc.rpc("ecos_guess_and_finalize_score", {
    p_user_id: userId,
    p_game_id: gameId,
    p_attempt_number: attemptNumber,
    p_guess_text: guessText,
    p_correct: evaluation.correct,
    p_correct_artist: evaluation.correctArtist,
    p_correct_album: evaluation.correctAlbum,
    p_points: scoreResult.totalPoints,
    p_guesses_used: attemptNumber,
    p_won: evaluation.correct,
    p_streak: newStreak,
    p_update_streak: updateStreak,
  });
  if (error) return { kind: "error", message: "Failed to save score", cause: error };

  // Avisa a quien tenga el ranking abierto (D7). Fire-and-forget: nunca falla ni retrasa.
  notifyRankingChanged();

  return { kind: "finalized", attemptNumber, scoreResult };
}

/**
 * Si la partida está terminada en `ecos_guesses` pero falta `ecos_scores`, la cierra con el mismo
 * cálculo que una jugada normal. Idempotente si ya existe puntuación.
 */
export async function repairOrphanScoreIfNeeded(
  supabase: SupabaseClient,
  userId: string,
  gameId: string,
  ctx: {
    gameDate: string;
    guesses: { correct: boolean; attempt_number: number }[];
  }
): Promise<boolean> {
  const outcome = decisiveOutcomeFromGuesses(ctx.guesses);
  if (!outcome) return false;

  const [{ data: existing }, { data: leaderboard }] = await Promise.all([
    supabase
      .from("ecos_scores")
      .select("id")
      .eq("user_id", userId)
      .eq("game_id", gameId)
      .maybeSingle(),
    supabase
      .from("ecos_leaderboard")
      .select("streak, last_played")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (existing) return false;

  const { error } = await finalizeFromStoredGuesses(supabase, {
    userId,
    gameId,
    gameDate: ctx.gameDate,
    outcome,
    leaderboard: leaderboard ?? null,
  });

  return !error;
}
