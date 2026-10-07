import type { HomeDayStatusData, InProgressProgress } from "@/lib/hooks/queries";
import type { PreviousDayGame } from "@/lib/queries/games";
import type { GameProgress } from "@/lib/store/gameProgressStore";

export type DerivedHomeDayState = {
  played: boolean;
  won: boolean;
  completed: boolean;
  inProgress: boolean;
  displayScore: number | null;
  displayTitle: string;
  displayArtist: string;
  displayCover: string;
  guesses: GameProgress["guesses"];
  maxAttempts: number;
};

/**
 * Estado de un día anterior tal y como lo pinta el archivo de la home (invitado vs usuario).
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
  const displayArtist = played
    ? (localProgress?.artist_name ?? status?.artist_name ?? day.artist_name)
    : "";
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
    displayArtist,
    displayCover,
    guesses,
    maxAttempts,
  };
}

/**
 * Estado de un día del histórico de la home: la fila del día más su partida a medias, si la hay.
 *
 * Antes cada tarjeta del carril y cada día del calendario tenía su propia query de estado
 * (`home.dayStatus`), sembrada con estos mismos datos: 278 observadores en el calendario y una
 * petición por día del mes al volver a la home. El histórico en caché ya lo parchean las jugadas,
 * así que basta con él.
 */
export function deriveHomeDayFromHistory(
  day: PreviousDayGame,
  userId: string | null,
  inProgress: InProgressProgress | undefined,
  byGameId: Record<string, GameProgress>
): DerivedHomeDayState {
  const status: HomeDayStatusData | null = userId
    ? {
        gameId: day.id,
        played: day.played,
        won: day.won,
        score: day.score,
        title: day.title,
        artist_name: day.artist_name,
        cover_url: day.cover_url,
        inProgress: inProgress ?? null,
      }
    : null;
  return deriveHomeDayState(day, userId, status, byGameId);
}
