import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPageSeo } from "@/lib/seo/pageMeta";
import { createClient } from "@/lib/supabase/server";
import { getLeaderboardByPeriod } from "@/lib/queries/users";
import { LeaderboardClient } from "@/components/leaderboard/LeaderboardClient";
import { RankingSkeleton } from "@/components/skeletons";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ranking" });
  return { title: t("title"), ...(await getPageSeo(locale, "/ranking")) };
}

/** Evita RSC obsoleto en servidor para el snapshot inicial del leaderboard. */
export const dynamic = "force-dynamic";

async function RankingPageContent() {
  const supabase = await createClient();
  // Los rankings no dependen de la sesión (RPC con el cliente anónimo): todo a la vez.
  const [
    {
      data: { user },
    },
    globalEntries,
    weeklyEntries,
    monthlyEntries,
  ] = await Promise.all([
    supabase.auth.getUser(),
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
    <Suspense fallback={<RankingSkeleton />}>
      <RankingPageContent />
    </Suspense>
  );
}
