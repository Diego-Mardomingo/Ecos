import type {
  GameWithSong,
  PreviousDayGame,
  InProgressProgress,
  TodaysCompletedResult,
} from "@/lib/queries/games";
import type { GameProgress } from "@/lib/store/gameProgressStore";
import type { UserStats } from "@/lib/queries/users";

/**
 * Formas de datos compartidas por las queries, el parcheado de caché y las mutaciones.
 *
 * Están aquí y no en `queries.ts` para que `gameCacheSync.ts` pueda importarlas sin crear una
 * dependencia circular con el módulo que lo usa.
 */

interface RankingStatsPeriod {
  points: number;
  rank: number | null;
}

export interface HomeData {
  todaysGame: GameWithSong | null;
  previousDays: PreviousDayGame[];
  userStats: UserStats | null;
  userId: string | null;
  inProgressByGameId?: Record<string, InProgressProgress>;
  todaysCompletedResult?: TodaysCompletedResult | null;
  rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
  rankingStats?: {
    global: RankingStatsPeriod;
    weekly: RankingStatsPeriod;
    monthly: RankingStatsPeriod;
  };
}

export interface HomeTodayData {
  todaysGame: GameWithSong | null;
  todaysCompletedResult: TodaysCompletedResult | null;
  todaysInProgress: InProgressProgress | null;
  userId: string | null;
}

export interface HomePreviousDaysData {
  previousDays: PreviousDayGame[];
  userId: string | null;
  inProgressByGameId?: Record<string, InProgressProgress>;
}

export interface HomeUserStatsData {
  userStats: UserStats | null;
  rankingRanks?: { global: number | null; weekly: number | null; monthly: number | null };
  rankingStats?: {
    global: RankingStatsPeriod;
    weekly: RankingStatsPeriod;
    monthly: RankingStatsPeriod;
  };
  userId: string | null;
}

export interface HomeDayStatusData {
  gameId: string;
  played: boolean;
  won: boolean;
  score: number | null;
  title: string;
  artist_name: string;
  cover_url: string;
  inProgress: InProgressProgress | null;
}

export interface GameProgressData {
  progress: GameProgress | null;
}

export interface SongSnapshot {
  title: string;
  artist_name: string;
  cover_url: string | null;
}

export interface GameCacheSnapshot {
  dayStatus: HomeDayStatusData | undefined;
  today: HomeTodayData | undefined;
  progress: GameProgressData | undefined;
  /**
   * Del histórico de la home (`home.previousDaysAll`), solo lo que toca el cambio optimista: la
   * fila del día y su partida a medias. `undefined` si el histórico no estaba en caché.
   */
  historyEntry:
    | {
        day: PreviousDayGame | undefined;
        inProgress: InProgressProgress | undefined;
      }
    | undefined;
}

export type GameMutationEvent = "attemptSaved" | "gameCompleted";

/**
 * Cambio optimista de la caché al hacer una jugada: la partida sigue en curso o queda terminada.
 * Lo comparten las dos mutaciones de partida y los constructores de `gameProgressSnapshots.ts`.
 */
export type GameOptimistic =
  | {
      type: "inProgress";
      inProgress: InProgressProgress;
    }
  | {
      type: "completion";
      won: boolean;
      score: number | null;
      completedProgress?: {
        gameDate?: string;
        guesses?: GameProgress["guesses"];
        correctAttempt?: number;
      };
    };

/**
 * Cuerpo de `/api/validate-guess`. El servidor decide por su cuenta si la jugada cierra la
 * partida y compara artista y álbum con la canción `songId` de la BD: no hace falta mandarle
 * nada más (S-1, auditoría oct. 2026).
 */
export interface ValidateGuessRequest {
  gameId: string;
  userId: string;
  attemptNumber: number;
  guessText: string;
  songId: string;
}

export interface ValidateGuessResponse {
  correct?: boolean;
  correctArtist?: boolean;
  correctAlbum?: boolean;
  totalPoints?: number;
  /** Intento con el que el servidor ha registrado la jugada; puede no ser el enviado. */
  attemptNumber?: number;
  /** La partida ya estaba cerrada: la respuesta trae la puntuación guardada, sin repuntuar. */
  alreadyFinalized?: boolean;
  error?: string;
}

export interface SkipAttemptRequest {
  gameId: string;
  attemptNumber: number;
}

export interface SkipAttemptResponse {
  ok?: boolean;
  /** Intento con el que el servidor ha registrado el salto; puede no ser el enviado. */
  attemptNumber?: number;
  /** La partida ya estaba cerrada: no se ha vuelto a puntuar. */
  alreadyFinalized?: boolean;
  error?: string;
}

export interface RankingData {
  entries: Array<{
    user_id: string;
    total_points: number;
    streak: number;
    global_rank: number;
    aciertos: number;
    profiles: { display_name: string; avatar_url: string } | null;
  }>;
  currentUserId: string | null;
}

export interface ProfileData {
  profile: {
    id: string;
    display_name: string;
    avatar_url: string;
    show_avatar_in_rankings: boolean;
    created_at: string;
    email: string;
    role: string | null;
  };
  stats: UserStats | null;
}

export interface ProfileCoreData {
  profile: ProfileData["profile"];
  userId: string | null;
}

export interface ProfileStatsData {
  stats: UserStats | null;
  userId: string | null;
}
