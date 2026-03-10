import { createClient } from "@/lib/supabase/server";
import { HomeClient } from "@/components/home/HomeClient";
import { getTodaysGameCached, getPreviousDaysCached } from "@/lib/queries/games";
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

  return (
    <HomeClient
      todaysGame={todaysGame}
      userStats={userStats}
      userId={user?.id ?? null}
      previousDays={previousDays}
    />
  );
}
