import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/queries/public-client";

export interface UserStats {
  total_points: number;
  games_played: number;
  games_won: number;
  streak: number;
  max_streak: number;
  global_rank: number | null;
  avg_guesses: number;
}

export interface RankingStatsPeriod {
  points: number;
  rank: number | null;
}

export interface RankingRanks {
  global: number | null;
  weekly: number | null;
  monthly: number | null;
}

export interface RankingStats {
  global: RankingStatsPeriod;
  weekly: RankingStatsPeriod;
  monthly: RankingStatsPeriod;
}

export interface UserDashboardStats {
  userStats: UserStats;
  rankingRanks: RankingRanks;
  rankingStats: RankingStats;
}

/** Respuesta de `get_user_ranking_stats` (Supabase devuelve una fila). */
type RankingStatsRow = {
  total_points: number | null;
  games_played: number | null;
  games_won: number | null;
  global_rank: number | null;
  streak: number | null;
  max_streak: number | null;
  weekly_points: number | null;
  weekly_rank: number | null;
  weekly_aciertos: number | null;
  monthly_points: number | null;
  monthly_rank: number | null;
  monthly_aciertos: number | null;
};

function emptyUserStats(avgGuesses: number): UserStats {
  return {
    total_points: 0,
    games_played: 0,
    games_won: 0,
    streak: 0,
    max_streak: 0,
    global_rank: null,
    avg_guesses: avgGuesses,
  };
}

function emptyDashboard(avgGuesses: number): UserDashboardStats {
  return {
    userStats: emptyUserStats(avgGuesses),
    rankingRanks: { global: null, weekly: null, monthly: null },
    rankingStats: {
      global: { points: 0, rank: null },
      weekly: { points: 0, rank: null },
      monthly: { points: 0, rank: null },
    },
  };
}

const toRank = (value: number | null): number | null => (value != null ? Number(value) : null);

/**
 * Estadísticas del propio usuario: globales y rankings semanal/mensual sin límite de top-N.
 *
 * Las dos RPC comprueban dentro que `userId` sea `auth.uid()`, así que necesitan el cliente de
 * cookies (con service role o anon devolverían vacío). Se puede pasar el que ya tenga la ruta.
 */
export async function getUserDashboardStats(
  userId: string,
  client?: SupabaseClient
): Promise<UserDashboardStats> {
  const supabase = client ?? (await createClient());

  const [rankRes, avgRes] = await Promise.all([
    supabase.rpc("get_user_ranking_stats", { p_user_id: userId }),
    supabase.rpc("get_user_avg_guesses", { p_user_id: userId }),
  ]);

  if (avgRes.error) console.error("get_user_avg_guesses:", avgRes.error);
  const avgGuesses = typeof avgRes.data === "number" ? avgRes.data : 0;

  if (rankRes.error) {
    console.error("get_user_ranking_stats:", rankRes.error);
    return emptyDashboard(avgGuesses);
  }

  const raw = rankRes.data;
  const row = (Array.isArray(raw) ? raw[0] : raw) as RankingStatsRow | undefined;
  if (!row) return emptyDashboard(avgGuesses);

  const globalRank = toRank(row.global_rank);
  const weeklyRank = toRank(row.weekly_rank);
  const monthlyRank = toRank(row.monthly_rank);

  return {
    userStats: {
      total_points: Number(row.total_points ?? 0),
      games_played: Number(row.games_played ?? 0),
      games_won: Number(row.games_won ?? 0),
      streak: Number(row.streak ?? 0),
      max_streak: Number(row.max_streak ?? 0),
      global_rank: globalRank,
      avg_guesses: avgGuesses,
    },
    rankingRanks: { global: globalRank, weekly: weeklyRank, monthly: monthlyRank },
    rankingStats: {
      global: { points: Number(row.total_points ?? 0), rank: globalRank },
      weekly: { points: Number(row.weekly_points ?? 0), rank: weeklyRank },
      monthly: { points: Number(row.monthly_points ?? 0), rank: monthlyRank },
    },
  };
}

/** Solo las estadísticas globales del propio usuario (perfil). */
export async function getUserStats(
  userId: string,
  client?: SupabaseClient
): Promise<UserStats | null> {
  return (await getUserDashboardStats(userId, client)).userStats;
}

// ---------------------------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------------------------

export interface LeaderboardEntryRow {
  user_id: string;
  total_points: number;
  streak: number;
  global_rank: number;
  aciertos: number;
  profiles: { display_name: string; avatar_url: string } | null;
}

export type LeaderboardPeriod = "weekly" | "monthly" | "global";

export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[] = ["weekly", "monthly", "global"];

/** Lo que tarda como mucho en verse un cambio de nombre o avatar en un periodo ya cerrado. */
const CLOSED_PERIOD_CACHE_SECONDS = 3600;

async function fetchLeaderboardByPeriod(
  supabase: SupabaseClient,
  period: LeaderboardPeriod,
  limit: number,
  referenceDate: string | null
): Promise<LeaderboardEntryRow[]> {
  const { data, error } = await supabase.rpc("get_leaderboard_by_period", {
    p_period: period,
    p_limit: limit,
    p_search: null,
    p_reference_date: referenceDate,
  });

  if (error) {
    console.error("getLeaderboardByPeriod error:", error);
    throw error;
  }

  return (data ?? []).map(
    (r: {
      user_id: string;
      total_points: number;
      streak: number;
      global_rank: number;
      aciertos?: number;
      display_name: string | null;
      avatar_url: string | null;
    }) => ({
      user_id: r.user_id,
      total_points: Number(r.total_points),
      streak: r.streak ?? 0,
      global_rank: r.global_rank ?? 0,
      aciertos: r.aciertos ?? 0,
      profiles:
        r.display_name != null || r.avatar_url != null
          ? {
              display_name: r.display_name ?? "",
              avatar_url: r.avatar_url ?? "",
            }
          : null,
    })
  );
}

/**
 * Ranking de un periodo en curso (o global). Sin caché de servidor a propósito: el ranking es en
 * tiempo real (Supabase Realtime avisa al cliente y este vuelve a pedirlo), y una caché aquí le
 * devolvería el dato de antes de la partida. La RPC es SECURITY DEFINER y abierta a `anon`, así
 * que va con el cliente anónimo: no depende de la sesión.
 *
 * Si la RPC falla devuelve `[]` y lo deja en el log (comportamiento de siempre en la página).
 */
export async function getLeaderboardByPeriod(
  period: LeaderboardPeriod,
  limit = 50
): Promise<LeaderboardEntryRow[]> {
  try {
    return await fetchLeaderboardByPeriod(createPublicClient(), period, limit, null);
  } catch {
    return [];
  }
}

/**
 * Ranking de un periodo semanal o mensual **ya cerrado** (el histórico): ya no cambia, así que va
 * cacheado. Quien llama decide que está cerrado; un periodo en curso tiene que ir por
 * {@link getLeaderboardByPeriod}.
 */
export async function getClosedPeriodLeaderboardCached(
  period: Exclude<LeaderboardPeriod, "global">,
  limit: number,
  referenceDate: string
): Promise<LeaderboardEntryRow[]> {
  return unstable_cache(
    () => fetchLeaderboardByPeriod(createPublicClient(), period, limit, referenceDate),
    ["leaderboard-closed", period, String(limit), referenceDate],
    { revalidate: CLOSED_PERIOD_CACHE_SECONDS }
  )();
}

/** Ranking de un periodo con fecha de referencia, sin caché (periodo en curso). */
export async function getLeaderboardForReference(
  period: Exclude<LeaderboardPeriod, "global">,
  limit: number,
  referenceDate: string
): Promise<LeaderboardEntryRow[]> {
  return fetchLeaderboardByPeriod(createPublicClient(), period, limit, referenceDate);
}
