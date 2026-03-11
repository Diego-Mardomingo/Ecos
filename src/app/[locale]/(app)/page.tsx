import { createClient } from "@/lib/supabase/server";
import { HomeClient } from "@/components/home/HomeClient";
import {
  getTodaysGameCached,
  getPreviousDaysCached,
  getInProgressGames,
} from "@/lib/queries/games";
import { getUserStats } from "@/lib/queries/users";

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

  const inProgressByGameId =
    user && (todaysGame || (previousDays?.length ?? 0) > 0)
      ? await getInProgressGames(
          user.id,
          todaysGame?.id ?? null,
          (previousDays ?? []).map((d) => d.id)
        )
      : {};

  return (
    <HomeClient
      initialData={{
        todaysGame,
        userStats: userStats ?? null,
        userId: user?.id ?? null,
        previousDays: previousDays ?? [],
        inProgressByGameId,
      }}
    />
  );
}
