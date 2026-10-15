import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCategoryBySlug,
  getCategoryLeaderboard,
  getUserCategorySummary,
  getVisibleCategories,
} from "@/lib/queries/categories";
import { CategoryGameClient } from "@/components/categories/CategoryGameClient";
import { categoryName } from "@/lib/categories/display";
import { redirectToLoginWithReturn } from "@/lib/auth/redirectToLogin";
import { localizedPath } from "@/lib/i18n/localizedPath";
import type { CategoriesResponse, CategoryRankingResponse } from "@/lib/categories/types";

/** Sin indexar: es la partida de una cuenta. Sin `openGraph`, por tanto sin `getPageSeo()`. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const category = await getCategoryBySlug(slug);
  // Sin categoría la página acaba en 404: que la pestaña lo diga en vez de quedarse sin título.
  const title = category
    ? categoryName(category, locale)
    : (await getTranslations({ locale, namespace: "common" }))("notFoundTitle");
  return { title, robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // El proxy ya redirige al invitado; esto es la comprobación de la propia página.
  if (!user) {
    redirectToLoginWithReturn(locale, localizedPath(locale, `/categorias/${encodeURIComponent(slug)}`));
  }

  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const [categories, summary, { entries, me }] = await Promise.all([
    getVisibleCategories(),
    getUserCategorySummary(user.id),
    getCategoryLeaderboard(category.id, user.id),
  ]);

  const initialCategories: CategoriesResponse = { categories, user: summary };
  const initialRanking: CategoryRankingResponse = {
    category: { slug: category.slug, name_es: category.name_es, name_en: category.name_en },
    entries,
    me,
    currentUserId: user.id,
  };

  return (
    <CategoryGameClient
      category={category}
      userId={user.id}
      initialCategories={initialCategories}
      initialRanking={initialRanking}
    />
  );
}
