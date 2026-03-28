import { getTranslations } from "next-intl/server";
import { PlayRouteSkeleton } from "@/components/skeletons";

export default async function PlayLoading() {
  const t = await getTranslations("game");
  return <PlayRouteSkeleton footer={<span>{t("loadingGame")}</span>} />;
}
