"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";

/**
 * Cabecera fija de la partida por categorías, con la misma factura que `GameHeader`: volver, el
 * nombre de la categoría con la racha y los puntos de la partida en curso, y un hueco a la derecha
 * para la acción de cada pantalla. Incluye su espaciador, porque al ser `fixed` no ocupa sitio.
 */
export function CategoryHeader({
  name,
  stats,
  action,
}: {
  name: string;
  /** Racha y puntos de la partida; sin ellos (pantalla de inicio) solo sale el nombre. */
  stats?: { streak: number; points: number };
  action?: ReactNode;
}) {
  const t = useTranslations("categories");
  const tc = useTranslations("common");
  const { formatNumber } = useAppFormatters();

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-50 pt-safe backdrop-blur-xl"
        style={{ background: "color-mix(in srgb, var(--background) 80%, transparent)" }}
      >
        <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-2 px-4">
          <Link
            href="/categorias"
            // Mide 40 px; el pseudo-elemento lleva la zona táctil a 44 sin cambiar el aspecto (UX-12).
            className="group relative flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-foreground transition-[transform,border-color] duration-200 before:absolute before:-inset-0.5 before:rounded-full before:content-[''] hover:border-brand/40 active:scale-90"
            aria-label={t("backToCategories")}
          >
            <span
              aria-hidden
              className="material-symbols-outlined text-xl transition-transform duration-200 group-hover:-translate-x-0.5"
            >
              arrow_back
            </span>
          </Link>
          <div className="min-w-0 flex-1 text-center leading-tight">
            <h1 className="block truncate text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
              {name}
            </h1>
            {stats ? (
              <p
                className="mt-0.5 flex items-center justify-center gap-2 text-xs font-semibold tabular-nums text-muted-foreground"
                aria-label={t("headerStats", {
                  streak: stats.streak,
                  points: formatNumber(stats.points),
                })}
              >
                <span aria-hidden className="inline-flex items-center gap-0.5 text-foreground">
                  <span
                    className="material-symbols-outlined text-sm text-brand"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    local_fire_department
                  </span>
                  {stats.streak}
                </span>
                <span aria-hidden>
                  {formatNumber(stats.points)} {tc("points")}
                </span>
              </p>
            ) : null}
          </div>
          <div className="flex min-w-10 shrink-0 justify-end">{action}</div>
        </div>
      </header>
      <div className="h-14 shrink-0 pt-safe box-content" aria-hidden />
    </>
  );
}
