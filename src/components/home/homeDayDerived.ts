import type { HomeDayStatusData } from "@/lib/hooks/queries";
import type { PreviousDayGame } from "@/lib/queries/games";
import type { GameProgress } from "@/lib/store/gameProgressStore";

export type DerivedHomeDayState = {
  played: boolean;
  won: boolean;
  completed: boolean;
  inProgress: boolean;
  displayScore: number | null;
  displayTitle: string;
  displayCover: string;
  guesses: GameProgress["guesses"];
  maxAttempts: number;
};

/**
 * Misma lógica que las tarjetas de «Días anteriores» en HomeClient (invitado vs usuario).
 */
export function deriveHomeDayState(
  day: PreviousDayGame,
  userId: string | null,
  status: HomeDayStatusData | undefined | null,
  byGameId: Record<string, GameProgress>
): DerivedHomeDayState {
  const rawServerInProgress = userId ? status?.inProgress ?? undefined : undefined;
  const serverInProgress =
    rawServerInProgress && rawServerInProgress.gameId === day.id
      ? rawServerInProgress
      : undefined;
  const storedForDay =
    byGameId[day.id]?.gameId === day.id ? byGameId[day.id] : undefined;
  const localProgress = (serverInProgress ?? storedForDay) as GameProgress | undefined;
  const played = userId ? (status?.played ?? day.played) : !!localProgress;
  const serverScore = status?.score ?? day.score;
  const serverWon = status?.won ?? day.won;
  const serverHasResult = Boolean(userId && played && serverScore != null);
  const displayTitle = played ? (localProgress?.title ?? status?.title ?? day.title) : "";
  const displayCover = played ? (localProgress?.cover_url ?? status?.cover_url ?? day.cover_url) : "";
  const displayScore = played
    ? serverHasResult
      ? serverScore
      : (localProgress?.score ?? serverScore)
    : null;
  const won = played && (serverHasResult ? serverWon : (localProgress?.won ?? serverWon));
  const completed = played && displayScore !== null;
  const inProgress =
    !serverHasResult &&
    localProgress?.phase === "playing" &&
    (localProgress?.guesses?.length ?? 0) > 0;
  const guesses = localProgress?.guesses ?? [];
  const maxAttempts = 6;
  return {
    played,
    won,
    completed,
    inProgress,
    displayScore,
    displayTitle,
    displayCover,
    guesses,
    maxAttempts,
  };
}

export type MonthGroupStats = {
  totalGames: number;
  completed: number;
};

export function aggregateMonthGroupStats(
  days: PreviousDayGame[],
  userId: string | null,
  dayStatusByGameId: Map<string, HomeDayStatusData>,
  byGameId: Record<string, GameProgress>
): MonthGroupStats {
  let completed = 0;
  for (const day of days) {
    const status = userId ? dayStatusByGameId.get(day.id) : undefined;
    const d = deriveHomeDayState(day, userId, status ?? null, byGameId);
    if (d.completed) completed++;
  }
  return {
    totalGames: days.length,
    completed,
  };
}
