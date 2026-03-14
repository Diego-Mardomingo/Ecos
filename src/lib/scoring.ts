// Puntuación base por número de intento (1-6)
const BASE_SCORES: Record<number, number> = {
  1: 1000,
  2: 800,
  3: 600,
  4: 400,
  5: 250,
  6: 150,
};

/** Bonus por cada día de racha: +20 pts/día (día 1 = 0, día 2+ = 20 cada uno). */
const STREAK_BONUS_PER_DAY = 20;

/**
 * Calcula el bonus total de racha.
 * streakDays = racha actual incluyendo el día que acaba de acertar.
 */
export function calculateStreakBonus(streakDays: number): number {
  if (streakDays <= 1) return 0;
  return (streakDays - 1) * STREAK_BONUS_PER_DAY;
}

/**
 * Total de puntos de racha que se sumarán en el próximo acierto (para mostrar en la UI).
 * currentStreak = racha actual antes de acertar. Ej: racha 4 → próximo acierto = streak 5 → +80 pts.
 */
export function getNextStreakBonusPoints(currentStreak: number): number {
  return calculateStreakBonus(currentStreak + 1);
}

export interface ScoreResult {
  basePoints: number;
  streakBonus: number;
  totalPoints: number;
}

/**
 * Calcula la puntuación final.
 * streakDays = racha tras acertar (incluye el día actual).
 */
export function calculateScore(
  attemptNumber: number,
  streakDays: number
): ScoreResult {
  const basePoints = BASE_SCORES[attemptNumber] ?? 0;
  const streakBonus = calculateStreakBonus(streakDays);

  return {
    basePoints,
    streakBonus,
    totalPoints: basePoints + streakBonus,
  };
}

/**
 * Genera el texto de resultado para compartir en redes sociales.
 * Ejemplo: ECOS #42 🎵\n🟩⬛⬛⬛⬛⬛\n1000 pts
 */
export function generateShareText(
  gameNumber: number,
  correctAttempt: number | null,
  totalAttempts = 6
): string {
  if (correctAttempt === null) {
    const boxes = "⬛".repeat(totalAttempts);
    return `ECOS #${gameNumber} 🎵\n${boxes}\nNo lo conseguí hoy`;
  }

  const correct = "🟩";
  const wrong = "⬛";
  const boxes =
    wrong.repeat(correctAttempt - 1) +
    correct +
    wrong.repeat(totalAttempts - correctAttempt);

  return `ECOS #${gameNumber} 🎵\n${boxes}\n¿Puedes superarme?`;
}

export { BASE_SCORES };
