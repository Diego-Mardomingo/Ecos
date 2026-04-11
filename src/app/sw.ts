/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

/** Evita que el SW cachee GET a /api (defaultCache usa NetworkFirst + caché 24h), datos de sesión quedarían obsoletos. */
const apiNetworkOnly = {
  matcher: ({
    sameOrigin,
    url: { pathname },
  }: {
    sameOrigin: boolean;
    url: URL;
  }) => sameOrigin && pathname.startsWith("/api/"),
  method: "GET" as const,
  handler: new NetworkOnly({ networkTimeoutSeconds: 10 }),
};

/** Imágenes estáticas y de CDN (mismo patrón de extensión en pathname). */
const imageCacheFirst = {
  matcher: ({ url }: { url: URL }) =>
    /\.(?:jpg|jpeg|png|webp|svg|gif|ico)$/i.test(url.pathname),
  method: "GET" as const,
  handler: new CacheFirst({
    cacheName: "ecos-images",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 120,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  }),
};

const googleFontsStylesheets = {
  matcher: ({ url }: { url: URL }) => url.hostname === "fonts.googleapis.com",
  method: "GET" as const,
  handler: new StaleWhileRevalidate({
    cacheName: "ecos-google-fonts-css",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 8,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  }),
};

const googleFontsWebfonts = {
  matcher: ({ url }: { url: URL }) => url.hostname === "fonts.gstatic.com",
  method: "GET" as const,
  handler: new CacheFirst({
    cacheName: "ecos-google-fonts-webfonts",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 32,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  }),
};

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    apiNetworkOnly,
    googleFontsStylesheets,
    googleFontsWebfonts,
    imageCacheFirst,
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
