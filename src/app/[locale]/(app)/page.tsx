import { createClient } from "@/lib/supabase/server";
import { HomeClient } from "@/components/home/HomeClient";
import {
  getTodaysGameCached,
  getPreviousDaysCached,
  getInProgressGames,
  getTodaysCompletedResult,
} from "@/lib/queries/games";
import { getUserDashboardStats } from "@/lib/queries/users";
import { getMadridDate } from "@/lib/date-utils";

function monthBounds(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  const start = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const nextDate = new Date(Date.UTC(y, m, 1));
  const nextMonth = `${nextDate.getUTCFullYear()}-${String(
    nextDate.getUTCMonth() + 1
  ).padStart(2, "0")}-01`;
  return { start, nextMonth };
}

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const currentMonth = getMadridDate().slice(0, 7);
  const monthRange = monthBounds(currentMonth);

  const [todaysGame, previousDays, dashboard] = await Promise.all([
    getTodaysGameCached(),
    getPreviousDaysCached(user?.id ?? null, undefined, {
      fromDate: monthRange.start,
      toDate: monthRange.nextMonth,
    }),
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
      }}
    />
  );
}
