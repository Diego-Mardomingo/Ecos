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

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
}

self.addEventListener("push", (event: PushEvent) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = { body: event.data?.text() ?? "" };
  }

  const title = payload.title ?? "\u{1F3A7} Ecos";
  const options: NotificationOptions = {
    body:
      payload.body ??
      "Aún no has completado la canción del día de hoy, ¡estás a tiempo! \u{1F644}",
    icon: payload.icon ?? "/ecos_icon_v2_192.png",
    badge: payload.badge ?? "/ecos_favicon_v2_32.png",
    tag: payload.tag ?? "ecos-daily-game",
    data: { url: payload.url ?? "/" },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string | undefined) ?? "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const sameOrigin = allClients.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      if (sameOrigin) {
        await sameOrigin.focus();
        if ("navigate" in sameOrigin) {
          await sameOrigin.navigate(targetUrl).catch(() => undefined);
        }
        return;
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});
