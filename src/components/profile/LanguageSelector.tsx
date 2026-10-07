"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsRow } from "@/components/profile/SettingsRow";

/** Fila de ajustes para cambiar de idioma. El cambio va en una transición: re-renderiza la ruta. */
export function LanguageSelector() {
  const t = useTranslations("profile.settings");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleLocaleChange = (newLocale: "es" | "en") => {
    if (locale === newLocale) return;
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
  };

  return (
    <SettingsRow icon="translate" iconClass="bg-sky-500/15 text-sky-500" label={t("language")}>
      <SegmentedControl
        size="sm"
        label={t("language")}
        options={[
          { value: "es", label: "ES" },
          { value: "en", label: "EN" },
        ]}
        value={locale === "en" ? "en" : "es"}
        onChange={handleLocaleChange}
        disabled={isPending}
      />
    </SettingsRow>
  );
}
