import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ranking" });
  return {
    title: t("historyTitle"),
  };
}

export default function RankingHistoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="pt-3 sm:pt-4">
      {children}
    </div>
  );
}
