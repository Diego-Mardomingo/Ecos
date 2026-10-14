"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Entrada a las categorías (modo racha) desde la home, bajo el reto de hoy. Mismo lenguaje que
 * `HomeGuestCard`: tarjeta redondeada con icono en un recuadro, dos líneas de texto y una flecha.
 */
export function HomeCategoriesCard() {
  const t = useTranslations("home");
  return (
    // Entrada en CSS: con framer llegaba con `opacity:0` en el HTML del servidor (PERF-04).
    <section className="animate-in fade-in slide-in-from-bottom-3 animation-duration-450 [--tw-ease:cubic-bezier(0.22,1,0.36,1)] [--tw-animation-delay:80ms] fill-mode-backwards">
      <Link
        href="/categorias"
        className="group relative flex items-center gap-3 overflow-hidden rounded-3xl border border-border bg-card px-4 py-4 transition-[border-color,transform] duration-200 hover:border-brand/40 active:scale-[0.98]"
      >
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand/15 ring-1 ring-brand/30 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
          <span
            aria-hidden
            className="material-symbols-outlined text-[22px] text-brand"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            category
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("categoriesCardTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("categoriesCardDescription")}</p>
        </div>
        <span
          aria-hidden
          className="material-symbols-outlined text-brand transition-transform duration-300 group-hover:translate-x-1"
        >
          arrow_forward
        </span>
      </Link>
    </section>
  );
}
