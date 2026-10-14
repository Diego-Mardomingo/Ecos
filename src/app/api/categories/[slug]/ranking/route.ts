import { NextRequest, NextResponse } from "next/server";
import { getRequestUser, handleRoute, jsonError, PRIVATE_NO_STORE } from "@/lib/api/route";
import { getCategoryBySlug, getCategoryLeaderboard } from "@/lib/queries/categories";
import type { CategoryRankingResponse } from "@/lib/categories/types";

/**
 * Ranking de una categoría: top 50 (caché de servidor con etiqueta, se invalida al terminar una
 * partida con puntos) y, con sesión, la fila del usuario si queda fuera del top. Lleva
 * `currentUserId`, así que es `private, no-store`.
 */
export const GET = handleRoute(
  "api/categories/[slug]/ranking",
  async (_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    const { slug } = await params;
    const [{ user }, category] = await Promise.all([getRequestUser(), getCategoryBySlug(slug)]);
    if (!category) return jsonError(404, "Category not found");

    const { entries, me } = await getCategoryLeaderboard(category.id, user?.id ?? null);

    const body: CategoryRankingResponse = {
      category: { slug: category.slug, name_es: category.name_es, name_en: category.name_en },
      entries,
      me,
      currentUserId: user?.id ?? null,
    };
    return NextResponse.json(body, { headers: PRIVATE_NO_STORE });
  }
);
