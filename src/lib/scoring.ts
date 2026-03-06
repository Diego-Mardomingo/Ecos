// Puntuación base por número de intento (1-6)
const BASE_SCORES: Record<number, number> = {
  1: 1000,
  2: 800,
  3: 600,
  4: 400,
  5: 200,
  6: 100,
};

// Bonus de racha: +50 puntos por cada día consecutivo (máximo +500)
const STREAK_BONUS_PER_DAY = 50;
const MAX_STREAK_BONUS = 500;

export interface ScoreResult {
  basePoints: number;
  streakBonus: number;
  totalPoints: number;
}

/**
 * Calcula la puntuación final.
 * Esta lógica debe replicarse en la Edge Function de Supabase para
 * que la validación en servidor sea la fuente de verdad.
 */
export function calculateScore(
  attemptNumber: number,
  streakDays: number
): ScoreResult {
  const basePoints = BASE_SCORES[attemptNumber] ?? 0;
  const streakBonus = Math.min(
    (streakDays - 1) * STREAK_BONUS_PER_DAY,
    MAX_STREAK_BONUS
  );

  return {
    basePoints,
    streakBonus,
    totalPoints: basePoints + streakBonus,
  };
}

/**
 * Genera el texto de resultado para compartir en redes sociales.
 * Ejemplo: Ecos #42 🎵\n🟩⬛⬛⬛⬛⬛\n1000 pts
 */
export function generateShareText(
  gameNumber: number,
  correctAttempt: number | null,
  totalAttempts = 6
): string {
  if (correctAttempt === null) {
    const boxes = "⬛".repeat(totalAttempts);
    return `Ecos #${gameNumber} 🎵\n${boxes}\nNo lo conseguí hoy`;
  }

  const correct = "🟩";
  const wrong = "⬛";
  const boxes =
    wrong.repeat(correctAttempt - 1) +
    correct +
    wrong.repeat(totalAttempts - correctAttempt);

  return `Ecos #${gameNumber} 🎵\n${boxes}\n¿Puedes superarme?`;
}

export { BASE_SCORES, STREAK_BONUS_PER_DAY, MAX_STREAK_BONUS };
