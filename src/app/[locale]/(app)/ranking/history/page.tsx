import { getLeaderboardPeriodSummaries } from "@/lib/queries/leaderboard-history";
import { LeaderboardHistoryListClient } from "@/components/leaderboard/LeaderboardHistoryListClient";

export default async function RankingHistoryPage() {
  const [weekly, monthly] = await Promise.all([
    getLeaderboardPeriodSummaries("weekly", 12),
    getLeaderboardPeriodSummaries("monthly"),
  ]);

  return (
    <LeaderboardHistoryListClient
      initialSummaries={{ weekly, monthly }}
    />
  );
}
