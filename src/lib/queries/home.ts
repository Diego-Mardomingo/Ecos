import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getEffectiveGameDate, monthBounds, shiftMonthKey } from "@/lib/date-utils";
import {
  fetchInProgressGames,
  fetchUserScores,
  getPastGamesCached,
  getTodaysCompletedResult,
  getTodaysGameCached,
  toPreviousDays,
  type GameWithSong,
  type InProgressProgress,
  type PreviousDayGame,
  type TodaysCompletedResult,
} from "@/lib/queries/games";
import {
  getUserDashboardStats,
  type RankingRanks,
  type RankingStats,
  type UserStats,
} from "@/lib/queries/users";

/**
 * Cargas de la home, compartidas por la página (`(app)/page.tsx`) y por `/api/home*`.
 *
 * Antes la misma secuencia estaba copiada tres veces y encadenaba hasta 7 viajes en serie a la BD
 * (auditoría oct. 2026, PERFDB-02 / DUP-08). Ahora, con la sesión ya resuelta, todo sale en **un
 * solo nivel de `Promise.all`**: lo común (canción de hoy, calendario) viene de la caché de
 * servidor y lo del usuario son consultas en paralelo que no dependen unas de otras.
 *
 * Las formas de respuesta son las de siempre (`HomeData`, `HomeTodayData`, `HomePreviousDaysData`
 * en `src/lib/hooks/queryTypes.ts`): el cliente siembra la caché con ellas.
 */

export interface HomePayload {
  todaysGame: GameWithSong | null;
  previousDays: PreviousDayGame[];
  userStats: UserStats | null;
  userId: string | null;
  inProgressByGameId: Record<string, InProgressProgress>;
  todaysCompletedResult: TodaysCompletedResult | null;
  rankingRanks: RankingRanks | undefined;
  rankingStats: RankingStats | undefined;
}

/**
 * Todo lo de la home: hoy, histórico completo y estadísticas.
 *
 * `effectiveDate` solo para la precarga de medianoche (`/api/home?effectiveDate=<mañana>`), que
 * la ruta valida antes; por defecto, hoy en Madrid.
 */
export async function loadHomePayload({
  supabase,
  user,
  effectiveDate = getEffectiveGameDate(),
}: {
  supabase: SupabaseClient;
  user: User | null;
  effectiveDate?: string;
}): Promise<HomePayload> {
  if (!user) {
    const [todaysGame, past] = await Promise.all([
      getTodaysGameCached(effectiveDate),
      getPastGamesCached(effectiveDate),
    ]);
    return {
      todaysGame,
      previousDays: toPreviousDays(past, null),
      userStats: null,
      userId: null,
      inProgressByGameId: {},
      todaysCompletedResult: null,
      rankingRanks: undefined,
      rankingStats: undefined,
    };
  }

  const [todaysGame, past, scores, inProgressByGameId, dashboard] = await Promise.all([
    getTodaysGameCached(effectiveDate),
    getPastGamesCached(effectiveDate),
    fetchUserScores(supabase, user.id),
    fetchInProgressGames(supabase, user.id, { upTo: effectiveDate }),
    getUserDashboardStats(user.id, supabase),
  ]);

  return {
    todaysGame,
    previousDays: toPreviousDays(past, scores),
    userStats: dashboard.userStats,
    userId: user.id,
    inProgressByGameId,
    todaysCompletedResult: getTodaysCompletedResult(todaysGame, scores),
    rankingRanks: dashboard.rankingRanks,
    rankingStats: dashboard.rankingStats,
  };
}

export interface HomeTodayPayload {
  todaysGame: GameWithSong | null;
  todaysCompletedResult: TodaysCompletedResult | null;
  todaysInProgress: InProgressProgress | null;
  userId: string | null;
}

/** Solo el día de hoy: canción, resultado si ya se jugó y partida a medias. */
export async function loadHomeToday({
  supabase,
  user,
}: {
  supabase: SupabaseClient;
  user: User | null;
}): Promise<HomeTodayPayload> {
  const today = getEffectiveGameDate();
  if (!user) {
    return {
      todaysGame: await getTodaysGameCached(today),
      todaysCompletedResult: null,
      todaysInProgress: null,
      userId: null,
    };
  }

  // Lo del usuario se filtra por fecha y no por id: así no espera a tener el juego.
  const [todaysGame, scores, inProgress] = await Promise.all([
    getTodaysGameCached(today),
    fetchUserScores(supabase, user.id, { from: today }),
    fetchInProgressGames(supabase, user.id, { from: today, upTo: today }),
  ]);

  return {
    todaysGame,
    todaysCompletedResult: getTodaysCompletedResult(todaysGame, scores),
    todaysInProgress: todaysGame ? (inProgress[todaysGame.id] ?? null) : null,
    userId: user.id,
  };
}

export interface HomeMonthPayload {
  previousDays: PreviousDayGame[];
  inProgressByGameId: Record<string, InProgressProgress>;
  userId: string | null;
  month: string;
  nextMonth: string | null;
  hasMoreOlder: boolean;
}

/**
 * Días pasados de un mes (`YYYY-MM`) para el archivo de la home. `null` si el mes no es válido.
 * `nextMonth` es el mes anterior (el siguiente que hay que pedir hacia atrás), si queda alguno.
 */
export async function loadHomeMonth({
  supabase,
  user,
  month,
}: {
  supabase: SupabaseClient;
  user: User | null;
  month: string;
}): Promise<HomeMonthPayload | null> {
  const bounds = monthBounds(month);
  if (!bounds) return null;

  const today = getEffectiveGameDate();
  // Solo días pasados: el de hoy no es del archivo (ni sus partidas a medias).
  const range = { from: bounds.start, to: bounds.end < today ? bounds.end : today };

  const [past, scores, inProgressByGameId] = await Promise.all([
    getPastGamesCached(today),
    user ? fetchUserScores(supabase, user.id, range) : Promise.resolve(null),
    user
      ? fetchInProgressGames(supabase, user.id, { ...range, upTo: today })
      : Promise.resolve({}),
  ]);

  // El calendario va del más reciente al más antiguo: el último es el primer juego de todos.
  const oldest = past[past.length - 1];
  const hasMoreOlder = oldest != null && oldest.date < bounds.start;

  return {
    previousDays: toPreviousDays(past, scores, range),
    inProgressByGameId,
    userId: user?.id ?? null,
    month,
    nextMonth: hasMoreOlder ? shiftMonthKey(month, -1) : null,
    hasMoreOlder,
  };
}
