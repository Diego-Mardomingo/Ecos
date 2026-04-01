import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateScore } from "@/lib/scoring";
import { getEffectiveGameDate, getMadridYesterdayDateString, toDateKey } from "@/lib/date-utils";

export interface LeaderboardSnapshot {
  streak: number | null;
  last_played: string | null;
}

/**
 * Replica la lógica de racha y puntuación de `validate-guess` para poder
 * reutilizarla en autorreparación y otras rutas.
 */
export function computeFinalizeParams(opts: {
  gameDate: string;
  isCorrect: boolean;
  attemptNumber: number;
  leaderboard: LeaderboardSnapshot | null;
}): {
  newStreak: number;
  updateStreak: boolean;
  scoreResult: { basePoints: number; streakBonus: number; totalPoints: number };
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

/**
 * Si la partida está terminada en `ecos_guesses` pero falta `ecos_scores`, aplica el mismo RPC de finalización.
 * Idempotente si ya existe score.
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
  const { guesses, gameDate } = ctx;
  if (guesses.length === 0) return false;

  const won = guesses.some((g) => g.correct);
  const maxAttempt = Math.max(...guesses.map((g) => g.attempt_number));
  const lost = !won && maxAttempt >= 6;
  if (!won && !lost) return false;

  const { data: existing } = await supabase
    .from("ecos_scores")
    .select("id")
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .maybeSingle();
  if (existing) return false;

  const isCorrect = won;
  const attemptNumber = won
    ? guesses
        .filter((g) => g.correct)
        .sort((a, b) => a.attempt_number - b.attempt_number)[0]!.attempt_number
    : 6;

  const { data: leaderboard } = await supabase
    .from("ecos_leaderboard")
    .select("streak, last_played")
    .eq("user_id", userId)
    .single();

  const { newStreak, updateStreak, scoreResult } = computeFinalizeParams({
    gameDate,
    isCorrect,
    attemptNumber,
    leaderboard: leaderboard ?? null,
  });

  const { error } = await supabase.rpc("ecos_finalize_game_score", {
    p_user_id: userId,
    p_game_id: gameId,
    p_points: scoreResult.totalPoints,
    p_guesses_used: attemptNumber,
    p_correct: isCorrect,
    p_won: isCorrect,
    p_streak: newStreak,
    p_update_streak: updateStreak,
  });

  return !error;
}