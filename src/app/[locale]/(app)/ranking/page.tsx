import { createClient } from "@/lib/supabase/server";
import { getLeaderboard } from "@/lib/queries/users";
import { LeaderboardClient } from "@/components/leaderboard/LeaderboardClient";

export default async function RankingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const leaderboard = await getLeaderboard(50);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <LeaderboardClient entries={leaderboard as any} currentUserId={user?.id ?? null} />;
}
