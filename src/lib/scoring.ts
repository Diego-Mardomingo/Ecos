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
function calculateStreakBonus(streakDays: number): number {
  if (streakDays <= 1) return 0;
  return (streakDays - 1) * STREAK_BONUS_PER_DAY;
}

export interface ScoreResult {
  basePoints: number;
  streakBonus: number;
  totalPoints: number;
}

/**
 * Calcula la puntuación final.
 * streakDays = racha tras acertar (incluye el día actual).
 * En `validate-guess` se pasa streakDays = 1 para no aplicar bonus de racha (solo puntos base por intento).
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
 * Intento en el que se acertó, deducido de los puntos de la partida. `null` si no se acertó
 * (0 puntos) o no hay puntos.
 *
 * Sirve donde solo llega la puntuación y no los intentos uno a uno (el histórico de la home). Como
 * `validate-guess` no suma bonus de racha, los puntos son exactamente la base del intento; aun así
 * se toma el intento de mayor base que no supera la puntuación, por si alguna partida antigua
 * llevara algo encima.
 */
export function attemptFromScore(score: number | null | undefined): number | null {
  if (score == null || score <= 0) return null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (score >= BASE_SCORES[attempt]) return attempt;
  }
  return 6;
}

export { BASE_SCORES };
