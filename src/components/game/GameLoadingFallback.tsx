"use client";

import { useTranslations } from "next-intl";

export function GameLoadingFallback() {
  const t = useTranslations("game");
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4">
      <span
        className="material-symbols-outlined animate-spin text-6xl text-brand"
        aria-hidden
      >
        progress_activity
      </span>
      <p className="text-sm text-muted-foreground">{t("loadingGame")}</p>
    </div>
  );
}
