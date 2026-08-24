import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseHost = new URL(supabaseUrl).hostname;

/**
 * Content-Security-Policy en modo **Report-Only** a proposito.
 *
 * Se despliega asi porque una CSP mal ajustada rompe la app en silencio: bloquear
 * www.youtube.com deja sin audio las canciones sin `preview_url`, y bloquear
 * accounts.google.com impide iniciar sesion. En Report-Only el navegador no bloquea nada, solo
 * registra las violaciones en la consola.
 *
 * Para promoverla: revisar la consola en la home, en una partida (con y sin preview) y en el
 * login; si no aparecen violaciones, renombrar la cabecera a "Content-Security-Policy". Mientras
 * siga en Report-Only, quien protege contra clickjacking es el X-Frame-Options de abajo.
 *
 * Origenes, todos verificados en el codigo:
 *  - accounts.google.com  -> Google Identity Services (LoginClient.tsx)
 *  - www.youtube.com      -> iframe_api (youtube-player.ts); s.ytimg.com lo carga esa API
 *  - fonts.googleapis.com -> hoja de Material Symbols ([locale]/layout.tsx)
 *  - fonts.gstatic.com    -> ficheros de fuente
 *  - transparenttextures  -> background-image en HomeClient.tsx
 *  - los CDN de caratulas -> avatares y portadas van por <img> plano (ver CLAUDE.md)
 *  - supabase (https+wss) -> REST y realtime
 *
 * 'unsafe-inline' e 'unsafe-eval' en script-src son necesarios hoy: Next inyecta su bootstrap
 * inline y next-themes un script inline para evitar el flash de tema. Quitarlos exige pasar a
 * nonces, que es un cambio aparte.
 */
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  [
    "img-src 'self' data: blob:",
    "https://lh3.googleusercontent.com",
    "https://i.scdn.co",
    "https://image-cdn-fa.spotifycdn.com",
    "https://image-cdn-ak.spotifycdn.com",
    "https://cdn-images.dzcdn.net",
    "https://cdns-images.dzcdn.net",
    "https://e-cdns-images.dzcdn.net",
    "https://www.transparenttextures.com",
    `https://${supabaseHost}`,
  ].join(" "),
  "media-src 'self' blob:",
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://accounts.google.com`,
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://accounts.google.com",
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
          {
            key: "Content-Security-Policy-Report-Only",
            value: cspReportOnly,
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn-images.dzcdn.net",
      },
      {
        protocol: "https",
        hostname: "cdns-images.dzcdn.net",
      },
      {
        protocol: "https",
        hostname: "e-cdns-images.dzcdn.net",
      },
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
