import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseHost = new URL(supabaseUrl).hostname;

/**
 * Content-Security-Policy, todavía en modo **Report-Only**.
 *
 * Se despliega así porque una CSP mal ajustada rompe la app en silencio: bloquear
 * accounts.google.com impide iniciar sesión. En Report-Only el navegador no bloquea nada, solo
 * registra las violaciones en la consola.
 *
 * Para promoverla: revisar la consola en la home, en una partida y en el login (con el inicio de
 * sesión de Google completo, One Tap incluido), en tema claro y oscuro, y también la consola del
 * service worker (ver connect-src). Si no aparecen violaciones, cambiar `cspHeaderName` a
 * "Content-Security-Policy". Mientras siga en Report-Only, quien protege contra clickjacking es
 * el X-Frame-Options de abajo.
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
 * Las imágenes también van en connect-src por el service worker: la caché por defecto de Serwist
 * intercepta todas las peticiones a otros orígenes y las repite con fetch() desde el SW, y ese
 * fetch() lo gobierna el connect-src de la CSP con la que se sirve /serwist/sw.js (esta misma).
 * Sin ellas, con la CSP bloqueante la PWA dejaría de cargar avatares y miniaturas. Esas
 * violaciones salen en la consola del SW, no en la de la página.
 *
 * 'unsafe-inline' en script-src sigue siendo necesario: Next inyecta su bootstrap inline y
 * next-themes un script inline para evitar el flash de tema. Quitarlo exige pasar a nonces, que
 * obliga a renderizar todo en dinámico; es un cambio aparte. 'unsafe-eval' solo hace falta en
 * desarrollo (el refresco en caliente de Next evalúa código); el build de producción no lo usa.
 */
const cspHeaderName = "Content-Security-Policy-Report-Only";

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
  [
    "connect-src 'self'",
    `wss://${supabaseHost}`,
    "https://accounts.google.com",
    ...imageHosts,
  ].join(" "),
  "frame-src https://accounts.google.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
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
        // Fuente de iconos autoalojada: el nombre lleva el hash del contenido (ver globals.css),
        // así que se puede cachear para siempre. Por defecto Next sirve `public/` con max-age=0.
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
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
