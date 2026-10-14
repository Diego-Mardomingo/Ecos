"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useCategories } from "@/lib/hooks/queries";
import type { CategoriesResponse, CategorySummary, UserCategorySummary } from "@/lib/categories/types";
import { categoryName } from "@/lib/categories/display";
import { useLoginHref } from "@/components/game/useLoginHref";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

/**
 * Lista de categorías del modo racha: nombre, icono y tamaño del pool; con sesión, la mejor marca
 * y «Continuar» si hay una partida a medias. El invitado ve la lista y una invitación a entrar
 * (la partida de cada categoría exige sesión).
 *
 * La siembra el RSC (`initialData`); `useCategories` solo la refresca al terminar una partida.
 */

const EASE_OUT = "[--tw-ease:cubic-bezier(0.22,1,0.36,1)]";

interface Props {
  userId: string | null;
  initialData: CategoriesResponse;
}

function CategoryCard({
  category,
  mine,
  index,
}: {
  category: CategorySummary;
  mine: UserCategorySummary | undefined;
  index: number;
}) {
  const t = useTranslations("categories");
  const locale = useLocale();
  const { formatNumber } = useAppFormatters();
  const activeRun = mine?.activeRun ?? null;
  const hasBest = mine != null && mine.bestPoints > 0;

  return (
    <li
      // Tope al escalonado: con muchas categorías, las últimas tardarían demasiado en aparecer.
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={cn(
        "animate-in fade-in slide-in-from-bottom-3 animation-duration-400 fill-mode-backwards",
        EASE_OUT
      )}
    >
      <Link
        href={`/categorias/${category.slug}`}
        className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-3xl border border-border bg-card p-4 transition-[border-color,transform] duration-200 hover:border-brand/40 active:scale-[0.97]"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-brand ring-1 ring-brand/30 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
            <span
              aria-hidden
              className="material-symbols-outlined text-[22px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {category.icon}
            </span>
          </span>
          {activeRun ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold text-primary-foreground">
              <span
                aria-hidden
                className="material-symbols-outlined text-sm"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                play_arrow
              </span>
              {t("continueRun")}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-balance text-[15px] font-bold leading-tight">
            {categoryName(category, locale)}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("songsCount", { count: category.pool_size })}
          </p>
        </div>
        {hasBest ? (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
            <span
              aria-hidden
              className="material-symbols-outlined text-base text-brand"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              emoji_events
            </span>
            <span className="truncate">
              {t("bestMark", { points: formatNumber(mine.bestPoints), streak: mine.bestStreak })}
            </span>
          </p>
        ) : null}
      </Link>
    </li>
  );
}

export function CategoriesClient({ userId, initialData }: Props) {
  const t = useTranslations("categories");
  const tc = useTranslations("common");
  const loginHref = useLoginHref();
  const { data } = useCategories(userId, initialData);
  const categories = data?.categories ?? [];
  const mineById = data?.user ?? null;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col px-4">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} />

      <p className="mb-3 text-sm text-muted-foreground">{t("intro")}</p>

      {!userId && (
        // Entrada en CSS: con framer llegaba con `opacity:0` en el HTML del servidor (PERF-04).
        <div className="mb-4 flex animate-in items-center gap-3 rounded-3xl border border-brand/25 bg-gradient-to-br from-brand/12 via-card to-card px-4 py-3 fade-in slide-in-from-bottom-2 animation-duration-300 [--tw-ease:cubic-bezier(0.22,1,0.36,1)]">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-brand">
            <span
              aria-hidden
              className="material-symbols-outlined text-xl"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              emoji_events
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t("guestTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("guestDescription")}</p>
          </div>
          <Link
            href={loginHref}
            className="shrink-0 rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-primary-foreground transition-transform active:scale-95"
          >
            {tc("enter")}
          </Link>
        </div>
      )}

      {categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <span
              aria-hidden
              className="material-symbols-outlined text-3xl text-muted-foreground"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              category
            </span>
          </span>
          <p className="text-sm font-medium text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 pb-4">
          {categories.map((category, index) => (
            <CategoryCard
              key={category.id}
              category={category}
              mine={mineById?.[category.id]}
              index={index}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
