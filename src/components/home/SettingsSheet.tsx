"use client";

import { useTranslations } from "next-intl";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ThemeSelector } from "@/components/profile/ThemeSelector";
import { LanguageSelector } from "@/components/profile/LanguageSelector";

/**
 * Hoja de ajustes de la home: tema e idioma, accesibles también para invitados (en el perfil solo
 * los ve quien ha iniciado sesión). Reutiliza las mismas filas que la sección de ajustes del perfil.
 */
export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("home");

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("headerSettingsButton")}
      description={t("settingsDescription")}
      hideDescription
    >
      <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card">
        <ThemeSelector />
        <LanguageSelector />
      </div>
    </BottomSheet>
  );
}
