import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getLeaderboardByPeriod } from "@/lib/queries/users";
import { LeaderboardClient } from "@/components/leaderboard/LeaderboardClient";

export const metadata: Metadata = {
  title: "Ranking",
};

export default async function RankingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const leaderboard = await getLeaderboardByPeriod("global", 50);

  return (
    <LeaderboardClient
      initialData={{
        entries: leaderboard,
        currentUserId: user?.id ?? null,
      }}
    />
  );
}
