import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { localizedPath } from "@/lib/i18n/localizedPath";
import { getSiteUrl } from "@/lib/seo/siteUrl";

/** Solo las páginas públicas e indexables. Las partidas (`/play/<id>`) no se listan: son `noindex`. */
const PATHS = ["/", "/ranking"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  const abs = (path: string) => new URL(path, base).toString();

  return PATHS.flatMap((path) => {
    const languages = {
      ...Object.fromEntries(routing.locales.map((l) => [l, abs(localizedPath(l, path))])),
      "x-default": abs(localizedPath(routing.defaultLocale, path)),
    };
    return routing.locales.map((locale) => ({
      url: abs(localizedPath(locale, path)),
      changeFrequency: path === "/" ? ("daily" as const) : ("hourly" as const),
      alternates: { languages },
    }));
  });
}
