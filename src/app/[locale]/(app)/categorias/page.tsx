import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPageSeo } from "@/lib/seo/pageMeta";
import { createClient } from "@/lib/supabase/server";
import { getUserCategorySummary, getVisibleCategories } from "@/lib/queries/categories";
import { CategoriesClient } from "@/components/categories/CategoriesClient";
import type { CategoriesResponse } from "@/lib/categories/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "categories" });
  return { title: t("title"), ...(await getPageSeo(locale, "/categorias")) };
}

/** La lista lleva la marca del usuario: el HTML depende de la sesión. */
export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    categories,
  ] = await Promise.all([supabase.auth.getUser(), getVisibleCategories()]);

  // Lo del usuario no se cachea y va filtrado por el id de una sesión ya verificada.
  const summary = user ? await getUserCategorySummary(user.id) : null;
  const initialData: CategoriesResponse = { categories, user: summary };

  return <CategoriesClient userId={user?.id ?? null} initialData={initialData} />;
}
