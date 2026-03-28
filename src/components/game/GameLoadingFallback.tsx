"use client";

import { useTranslations } from "next-intl";
import { PlayGameSkeleton } from "@/components/skeletons";

export function GameLoadingFallback() {
  const t = useTranslations("game");
  return (
    <PlayGameSkeleton footer={<span>{t("loadingGame")}</span>} />
  );
}
