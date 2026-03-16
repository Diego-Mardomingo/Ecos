import { getTranslations } from "next-intl/server";

export default async function PlayLoading() {
  const t = await getTranslations("game");
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4">
      <div className="h-16 w-16 animate-pulse rounded-2xl bg-muted" />
      <div className="h-6 w-48 animate-pulse rounded bg-muted" />
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <p className="text-sm text-muted-foreground">{t("loadingGame")}</p>
    </div>
  );
}
