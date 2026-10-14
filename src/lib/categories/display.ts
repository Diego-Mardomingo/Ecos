import type { CategorySummary } from "@/lib/categories/types";

/** Nombre de la categoría en el idioma de la interfaz (los nombres vienen de la BD). */
export function categoryName(
  category: Pick<CategorySummary, "name_es" | "name_en">,
  locale: string
): string {
  return locale === "en" ? category.name_en : category.name_es;
}
