import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { HomeClient } from "@/components/home/HomeClient";
import { HomeSkeleton } from "@/components/skeletons";
import { loadHomePayload } from "@/lib/queries/home";

export const dynamic = "force-dynamic";

async function HomePageContent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const home = await loadHomePayload({ supabase, user });

  const gameIdsForPrefetch =
    user != null
      ? [
          ...(home.todaysGame?.id ? [home.todaysGame.id] : []),
          ...home.previousDays.map((d) => d.id),
        ]
      : [];

  return (
    <HomeClient
      initialData={{
        todaysGame: home.todaysGame,
        userStats: home.userStats,
        userId: home.userId,
        previousDays: home.previousDays,
        inProgressByGameId: home.inProgressByGameId,
        todaysCompletedResult: home.todaysCompletedResult,
        rankingRanks: home.rankingRanks,
        rankingStats: home.rankingStats,
        prefetchGameIds: gameIdsForPrefetch,
      }}
    />
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomePageContent />
    </Suspense>
  );
}
