import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo/siteUrl";

/**
 * Sin `Disallow: /play/`: las partidas llevan `noindex` en sus metadatos y el rastreador tiene que
 * llegar a leerlo; bloqueado por robots.txt, el buscador podría indexar la URL sin verlo.
 * Lo único que se bloquea de `/play` es la ruta exacta (`/play$`), que es la canción de hoy
 * y no tiene `noindex` propio.
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
        "/play$",
        "/en/admin",
        "/en/profile",
        "/en/login",
        "/en/play$",
      ],
    },
    sitemap: new URL("/sitemap.xml", getSiteUrl()).toString(),
  };
}
