import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { localizedPath } from "@/lib/i18n/localizedPath";

/**
 * Canonical, hreflang y Open Graph de una página indexable. Las rutas son relativas: Next las
 * resuelve contra `metadataBase` (`[locale]/layout.tsx`).
 *
 * Una página que define `openGraph` sustituye el objeto entero del layout, no lo fusiona; por eso
 * aquí se repiten `siteName`, `locale`, `title` y `description`.
 */
export async function getPageSeo(
  locale: string,
  path: string
): Promise<Pick<Metadata, "alternates" | "openGraph">> {
  const t = await getTranslations({ locale, namespace: "meta" });
  const url = localizedPath(locale, path);

  return {
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, localizedPath(l, path)])),
        "x-default": localizedPath(routing.defaultLocale, path),
      },
    },
    openGraph: {
      title: "ECOS",
      description: t("ogDescription"),
      type: "website",
      siteName: "ECOS",
      url,
      // La imagen por convención (`[locale]/opengraph-image.tsx`) no se hereda cuando la página
      // define `openGraph`: hay que apuntarla a mano.
      images: [{ url: `/${locale}/opengraph-image`, width: 1200, height: 630, alt: "ECOS" }],
      locale: locale === "en" ? "en_US" : "es_ES",
      alternateLocale: locale === "en" ? "es_ES" : "en_US",
    },
  };
}
