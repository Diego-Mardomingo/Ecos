import { Suspense } from "react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getLeaderboardByPeriod } from "@/lib/queries/users";
import { LeaderboardClient } from "@/components/leaderboard/LeaderboardClient";
import { RankingPodiumAndListSkeleton } from "@/components/skeletons";

export const metadata: Metadata = {
  title: "Ranking",
};

/** Evita RSC obsoleto en servidor para el snapshot inicial del leaderboard. */
export const dynamic = "force-dynamic";

async function RankingPageContent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [globalEntries, weeklyEntries, monthlyEntries] = await Promise.all([
    getLeaderboardByPeriod("global", 50),
    getLeaderboardByPeriod("weekly", 50),
    getLeaderboardByPeriod("monthly", 50),
  ]);

  const currentUserId = user?.id ?? null;

  return (
    <LeaderboardClient
      initialByPeriod={{
        global: { entries: globalEntries, currentUserId },
        weekly: { entries: weeklyEntries, currentUserId },
        monthly: { entries: monthlyEntries, currentUserId },
      }}
    />
  );
}

export default function RankingPage() {
  return (
    <Suspense fallback={<RankingPodiumAndListSkeleton />}>
      <RankingPageContent />
    </Suspense>
  );
}
