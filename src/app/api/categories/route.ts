import { NextResponse } from "next/server";
import { getRequestUser, handleRoute, PRIVATE_NO_STORE } from "@/lib/api/route";
import { getUserCategorySummary, getVisibleCategories } from "@/lib/queries/categories";
import type { CategoriesResponse } from "@/lib/categories/types";

/**
 * Categorías visibles (activas y con pool suficiente). La parte común va en caché de servidor; si
 * hay sesión se añade el resumen del usuario, que no se cachea. Como la respuesta puede llevar
 * datos del usuario, es siempre `private, no-store` (nunca `public`).
 */
export const GET = handleRoute("api/categories", async () => {
  const [{ user }, categories] = await Promise.all([getRequestUser(), getVisibleCategories()]);
  const summary = user ? await getUserCategorySummary(user.id) : null;

  const body: CategoriesResponse = { categories, user: summary };
  return NextResponse.json(body, { headers: PRIVATE_NO_STORE });
});
