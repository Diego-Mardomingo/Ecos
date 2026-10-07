import { unstable_cache } from "next/cache";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { createPublicClient } from "@/lib/queries/public-client";

export type LeaderboardHistoryGranularity = "weekly" | "monthly";

export const LEADERBOARD_HISTORY_GRANULARITIES: readonly LeaderboardHistoryGranularity[] = [
  "weekly",
  "monthly",
];

/** Semanas que se piden por defecto y como máximo (la RPC acota igual: 1–52). */
export const WEEKLY_SUMMARIES_DEFAULT = 12;
export const WEEKLY_SUMMARIES_MAX = 52;

export interface LeaderboardPeriodSummaryRow {
  period_start: string;
  period_end: string;
  winner_user_id: string | null;
  winner_points: number | null;
  winner_display_name: string | null;
  winner_avatar_url: string | null;
}

/**
 * Los resúmenes son de periodos **cerrados** (semanas anteriores a la actual, meses anteriores al
 * actual): no cambian con las partidas de hoy. La caché va por día de Madrid y se refresca cada
 * hora para que un cambio de nombre o avatar del ganador acabe viéndose.
 */
const SUMMARIES_CACHE_SECONDS = 3600;

async function fetchSummaries(
  granularity: LeaderboardHistoryGranularity,
  count: number | null,
  today: string
): Promise<LeaderboardPeriodSummaryRow[]> {
  const { data, error } = await createPublicClient().rpc("get_leaderboard_period_summaries", {
    p_granularity: granularity,
    p_count: count,
  });

  if (error) {
    console.error("getLeaderboardPeriodSummaries error:", error);
    throw error;
  }

  const rows: LeaderboardPeriodSummaryRow[] = (data ?? []).map(
    (r: {
      period_start: string;
      period_end: string;
      winner_user_id: string | null;
      winner_points: number | null;
      winner_display_name: string | null;
      winner_avatar_url: string | null;
    }) => ({
      period_start: r.period_start,
      period_end: r.period_end,
      winner_user_id: r.winner_user_id,
      winner_points: r.winner_points != null ? Number(r.winner_points) : null,
      winner_display_name: r.winner_display_name,
      winner_avatar_url: r.winner_avatar_url,
    })
  );

  if (granularity !== "monthly") return rows;

  const currentMonthKey = today.slice(0, 7);
  return rows.filter((r) => r.period_start.slice(0, 7) < currentMonthKey);
}

/**
 * Ganadores de los periodos cerrados, con caché de servidor. Lanza si la RPC falla (y el fallo
 * no se cachea): úsalo donde un error tenga que distinguirse de «no hay periodos», como la ruta
 * que responde con caché pública.
 */
export async function fetchLeaderboardPeriodSummaries(
  granularity: LeaderboardHistoryGranularity,
  count?: number
): Promise<LeaderboardPeriodSummaryRow[]> {
  const n =
    granularity === "weekly"
      ? Math.min(Math.max(1, count ?? WEEKLY_SUMMARIES_DEFAULT), WEEKLY_SUMMARIES_MAX)
      : null;
  const today = getEffectiveGameDate();
  return unstable_cache(
    () => fetchSummaries(granularity, n, today),
    ["leaderboard-summaries", granularity, String(n ?? "all"), today],
    { revalidate: SUMMARIES_CACHE_SECONDS }
  )();
}

/** Igual que {@link fetchLeaderboardPeriodSummaries}, pero con `[]` si falla (ya queda en el log). */
export async function getLeaderboardPeriodSummaries(
  granularity: LeaderboardHistoryGranularity,
  count?: number
): Promise<LeaderboardPeriodSummaryRow[]> {
  try {
    return await fetchLeaderboardPeriodSummaries(granularity, count);
  } catch {
    return [];
  }
}
