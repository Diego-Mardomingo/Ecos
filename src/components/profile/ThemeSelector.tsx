"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsRow } from "@/components/profile/SettingsRow";

/** Fila de ajustes para elegir tema: claro, oscuro o el del sistema. */
export function ThemeSelector() {
  const t = useTranslations("profile.theme");
  const { theme, setTheme } = useTheme();
  const mounted = useIsMounted();

  return (
    <SettingsRow icon="contrast" iconClass="bg-brand/15 text-brand" label={t("label")}>
      <SegmentedControl
        size="sm"
        label={t("label")}
        options={(["light", "dark", "system"] as const).map((th) => ({ value: th, label: t(th) }))}
        // Hasta montar no se sabe el tema guardado: sin selección para no mentir en el SSR.
        value={(mounted ? theme : undefined) as "light" | "dark" | "system"}
        onChange={setTheme}
      />
    </SettingsRow>
  );
}
