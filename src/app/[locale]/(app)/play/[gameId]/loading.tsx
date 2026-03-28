import { getTranslations } from "next-intl/server";
import { PlayGameSkeleton } from "@/components/skeletons";

export default async function PlayGameLoading() {
  const t = await getTranslations("game");
  return <PlayGameSkeleton footer={<span>{t("loadingGame")}</span>} />;
}
