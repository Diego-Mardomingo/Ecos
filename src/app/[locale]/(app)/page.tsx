import { createClient } from "@/lib/supabase/server";
import { HomeClient } from "@/components/home/HomeClient";
import {
  getTodaysGameCached,
  getPreviousDaysCached,
  getInProgressGames,
  getTodaysCompletedResult,
  getGamesWithSongByIds,
  type GameWithSong,
} from "@/lib/queries/games";
import { getUserDashboardStats } from "@/lib/queries/users";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [todaysGame, previousDays, dashboard] = await Promise.all([
    getTodaysGameCached(),
    getPreviousDaysCached(user?.id ?? null),
    user ? getUserDashboardStats(user.id) : Promise.resolve(undefined),
  ]);

  const userStats = dashboard?.userStats ?? null;
  const rankingRanks = dashboard?.rankingRanks;
  const rankingStats = dashboard?.rankingStats;

  const [inProgressByGameId, todaysCompletedResult] = await Promise.all([
    user && (todaysGame || (previousDays?.length ?? 0) > 0)
      ? getInProgressGames(
          user.id,
          todaysGame?.id ?? null,
          (previousDays ?? []).map((d) => d.id)
        )
      : {},
    user && todaysGame ? getTodaysCompletedResult(user.id, todaysGame.id) : null,
  ]);

  const gameIdsForPrefetch =
    user != null
      ? [
          ...(todaysGame?.id ? [todaysGame.id] : []),
          ...(previousDays ?? []).map((d) => d.id),
        ]
      : [];
  const gamesList =
    user != null && gameIdsForPrefetch.length > 0
      ? await getGamesWithSongByIds(gameIdsForPrefetch)
      : [];
  const prefetchedGamesById: Record<string, GameWithSong> = Object.fromEntries(
    gamesList.map((g) => [g.id, g])
  );

  return (
    <HomeClient
      initialData={{
        todaysGame,
        userStats,
        userId: user?.id ?? null,
        previousDays: previousDays ?? [],
        inProgressByGameId,
        todaysCompletedResult: todaysCompletedResult ?? null,
        rankingRanks,
        rankingStats,
        prefetchedGamesById,
      }}
    />
  );
}
