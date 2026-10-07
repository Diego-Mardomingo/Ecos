import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseHost = new URL(supabaseUrl).hostname;

/**
 * Content-Security-Policy bloqueante (promovida en oct. 2026 tras recorrer home, partida, ranking y
 * login de Google sin violaciones en Report-Only).
 *
 * Ojo al añadir orígenes: una CSP mal ajustada rompe la app en silencio (bloquear
 * accounts.google.com impide iniciar sesión). Antes de tocarla, pasar `cspHeaderName` a
 * "Content-Security-Policy-Report-Only", recorrer home, partida y login de Google (One Tap
 * incluido) en claro y oscuro mirando la consola de la página y la del service worker, y volver a
 * la bloqueante solo sin violaciones.
 *
 * El audio sale de /api/audio-proxy, que es mismo origen: lo cubre el 'self' de media-src.
 *
 * Orígenes, todos verificados en el código:
 *  - accounts.google.com  -> Google Identity Services (LoginClient.tsx): el script, su hoja
 *                            (/gsi/style), el iframe de One Tap y sus llamadas.
 *  - CDN de imágenes      -> carátulas de Spotify (las que van con `unoptimized` o por <img>
 *                            llegan directas al navegador; el resto pasa por /_next/image) y
 *                            avatares de Google y de Supabase Storage (<img> plano).
 *  - supabase (https+wss) -> REST, Storage y realtime.
 *
 * El service worker lleva su propia CSP (`swCsp`): la caché por defecto de Serwist intercepta
 * todas las peticiones a otros orígenes (imágenes, Supabase, el script de Google) y las repite con
 * fetch() desde el SW, y ese fetch() lo gobierna el connect-src de la CSP con la que se sirve
 * /serwist/sw.js. Por eso su connect-src incluye los CDN de imágenes, y el de las páginas no: así
 * la página no puede hacer fetch() a esos orígenes, solo pintarlos como <img>. Sin ellos en la
 * del SW, con la CSP bloqueante la PWA dejaría de cargar avatares y miniaturas. Esas violaciones
 * salen en la consola del SW, no en la de la página.
 *
 * 'unsafe-inline' en script-src sigue siendo necesario: Next inyecta su bootstrap inline y
 * next-themes un script inline para evitar el flash de tema. Quitarlo exige pasar a nonces, que
 * obliga a renderizar todo en dinámico; es un cambio aparte. 'unsafe-eval' solo hace falta en
 * desarrollo (el refresco en caliente de Next evalúa código); el build de producción no lo usa.
 */
const cspHeaderName = "Content-Security-Policy";

const imageHosts = [
  "https://lh3.googleusercontent.com",
  "https://i.scdn.co",
  "https://image-cdn-fa.spotifycdn.com",
  "https://image-cdn-ak.spotifycdn.com",
  `https://${supabaseHost}`,
];

const isDev = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://accounts.google.com`,
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "font-src 'self' data:",
  ["img-src 'self' data: blob:", ...imageHosts].join(" "),
  "media-src 'self' blob:",
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://accounts.google.com`,
  "frame-src https://accounts.google.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** CSP del service worker: solo carga su propio script y repite peticiones (ver arriba). */
const swCsp = [
  "default-src 'self'",
  "script-src 'self'",
  ["connect-src 'self'", "https://accounts.google.com", ...imageHosts].join(" "),
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Evita clickjacking (la app no se embebe a sí misma en ningún iframe).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: cspHeaderName, value: csp },
        ],
      },
      {
        // Va después a propósito: con la misma clave, la última regla que encaja sustituye a la
        // anterior, así que /serwist/sw.js recibe solo esta.
        source: "/serwist/:path*",
        headers: [{ key: cspHeaderName, value: swCsp }],
      },
    ];
  },
  /**
   * Las carátulas de la home y del resultado pasan por el optimizador (`next/image`): llegan en
   * WebP y a la talla justa. Cuesta cuota de Vercel, pero es una carátula por día (unas 300) y el
   * CDN de Spotify las sirve con max-age de seis meses, así que se transforman pocas veces. Las
   * miniaturas del buscador y del admin van con `unoptimized`.
   */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "i.scdn.co",
      },
      {
        protocol: "https",
        hostname: "image-cdn-fa.spotifycdn.com",
      },
      {
        protocol: "https",
        hostname: "image-cdn-ak.spotifycdn.com",
      },
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default withNextIntl(withSerwist(nextConfig));
