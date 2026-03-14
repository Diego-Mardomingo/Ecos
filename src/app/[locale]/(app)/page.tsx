import { createClient } from "@/lib/supabase/server";
import { HomeClient } from "@/components/home/HomeClient";
import {
  getTodaysGameCached,
  getPreviousDaysCached,
  getInProgressGames,
  getTodaysCompletedResult,
} from "@/lib/queries/games";
import { getUserStats, getLeaderboardByPeriod } from "@/lib/queries/users";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [todaysGame, userStats, previousDays] = await Promise.all([
    getTodaysGameCached(),
    user ? getUserStats(user.id) : null,
    getPreviousDaysCached(user?.id ?? null),
  ]);

  let rankingRanks: { global: number | null; weekly: number | null; monthly: number | null } | undefined;
  if (user?.id) {
    const [weeklyEntries, monthlyEntries] = await Promise.all([
      getLeaderboardByPeriod("weekly", 150),
      getLeaderboardByPeriod("monthly", 150),
    ]);
    const weeklyEntry = weeklyEntries.find((e) => e.user_id === user.id);
    const monthlyEntry = monthlyEntries.find((e) => e.user_id === user.id);
    rankingRanks = {
      global: userStats?.global_rank ?? null,
      weekly: weeklyEntry?.global_rank ?? null,
      monthly: monthlyEntry?.global_rank ?? null,
    };
  }

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

  return (
    <HomeClient
      initialData={{
        todaysGame,
        userStats: userStats ?? null,
        userId: user?.id ?? null,
        previousDays: previousDays ?? [],
        inProgressByGameId,
        todaysCompletedResult: todaysCompletedResult ?? null,
        rankingRanks,
      }}
    />
  );
}
