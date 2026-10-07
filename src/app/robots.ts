import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo/siteUrl";

/**
 * Sin `Disallow` de `/play`: la partida de hoy y las de días pasados llevan `noindex` en sus
 * metadatos y el rastreador tiene que llegar a leerlo; bloqueado por robots.txt, el buscador
 * podría indexar la URL sin verlo.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/profile",
        "/login",
        "/en/admin",
        "/en/profile",
        "/en/login",
      ],
    },
    sitemap: new URL("/sitemap.xml", getSiteUrl()).toString(),
  };
}
