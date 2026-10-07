"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { HowToPlaySheet } from "@/components/home/HowToPlaySheet";
import { FeedbackSheet } from "@/components/home/FeedbackSheet";
import { SettingsSheet } from "@/components/home/SettingsSheet";

/**
 * Cabecera de la home: logo de ECOS con el nombre en minúsculas, y los accesos a las hojas
 * inferiores «Cómo jugar» (`HowToPlaySheet`), de feedback (`FeedbackSheet`) y de ajustes
 * (`SettingsSheet`, tema e idioma también para invitados).
 */

const iconButtonClass =
  "group inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground shadow-sm backdrop-blur transition-[color,border-color,transform] duration-200 hover:border-brand/40 hover:text-foreground active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function HomeHeader() {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header
      className="sticky top-0 z-30 -mx-4 flex items-center justify-between px-4 py-3 backdrop-blur-xl"
      style={{ background: "color-mix(in srgb, var(--background) 78%, transparent)" }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Entrada en CSS, no en framer-motion: así el logo no llega oculto en el HTML del servidor
            (PERF-04). La curva con rebote imita el muelle que tenía. */}
        <div className="relative flex size-9 shrink-0 animate-in items-center justify-center overflow-hidden rounded-xl bg-brand/15 ring-1 ring-brand/30 fade-in zoom-in-60 -spin-in-12 animation-duration-500 [--tw-ease:cubic-bezier(0.34,1.56,0.64,1)]">
          <Image src="/ecos_icon_v2_192.png" alt="" width={36} height={36} className="object-contain" sizes="36px" />
        </div>
        <span className="font-display text-[23px] font-extrabold leading-none tracking-[-0.04em]">
          {tc("appName").toLowerCase()}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className={iconButtonClass}
          aria-label={t("aboutTitle")}
          title={t("headerInfoButton")}
        >
          <span aria-hidden className="material-symbols-outlined text-[22px] transition-transform duration-300 group-hover:rotate-12">
            help
          </span>
        </button>
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          className={iconButtonClass}
          aria-label={t("reportTitle")}
          title={t("headerReportButton")}
        >
          <span aria-hidden className="material-symbols-outlined text-[22px] transition-transform duration-300 group-hover:-rotate-12">
            bug_report
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={iconButtonClass}
          aria-label={t("headerSettingsButton")}
          title={t("headerSettingsButton")}
        >
          <span aria-hidden className="material-symbols-outlined text-[22px] transition-transform duration-500 group-hover:rotate-90">
            settings
          </span>
        </button>
      </div>

      <HowToPlaySheet open={helpOpen} onOpenChange={setHelpOpen} />
      <FeedbackSheet open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </header>
  );
}
