import { createClient } from "@/lib/supabase/server";
import { HomeClient } from "@/components/home/HomeClient";
import { getTodaysGame } from "@/lib/queries/games";
import { getUserStats } from "@/lib/queries/users";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [todaysGame, userStats] = await Promise.all([
    getTodaysGame(),
    user ? getUserStats(user.id) : null,
  ]);

  return <HomeClient todaysGame={todaysGame} userStats={userStats} user={user} />;
}
