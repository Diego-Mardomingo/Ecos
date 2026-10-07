/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

/*
 * Qué hace el service worker con cada petición. Lista explícita, sin el `defaultCache` de Serwist:
 * aquel guardaba con `NetworkFirst` el HTML y los RSC de todas las páginas (también `/profile` con
 * el email y la home autenticada) y se los servía a quien abriera el navegador sin red, incluso
 * después de cerrar sesión (PDATA-02). Ahora solo se guarda lo que es igual para todo el mundo.
 *
 * Lo que no casa con ninguna regla no pasa por el SW: va directo a la red con la caché HTTP normal
 * (las rutas `/api`, los RSC, Supabase, Google, las carátulas de otros dominios…).
 */

/**
 * Navegaciones: siempre a la red, y sin red, la página `/~offline` del precache (`fallbacks`).
 * Tienen que pasar por una estrategia para que funcionen el fallback y la precarga de navegación.
 */
const navigations: RuntimeCaching = {
  matcher: ({ request }) => request.mode === "navigate",
  handler: new NetworkOnly(),
};

/** JS, CSS y fuentes de Next: llevan hash en el nombre y no cambian nunca. */
const nextStatic: RuntimeCaching = {
  matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
  method: "GET",
  handler: new CacheFirst({
    cacheName: "ecos-static",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 120,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  }),
};

/** Imágenes estáticas propias (iconos, manifest). */
const imageCacheFirst: RuntimeCaching = {
  matcher: ({ sameOrigin, url }) =>
    sameOrigin && /\.(?:jpg|jpeg|png|webp|svg|gif|ico)$/i.test(url.pathname),
  method: "GET",
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

/** Carátulas optimizadas por Next (`/_next/image`). */
const nextImage: RuntimeCaching = {
  matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname === "/_next/image",
  method: "GET",
  handler: new StaleWhileRevalidate({
    cacheName: "next-image",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 64,
        maxAgeSeconds: 60 * 60 * 24 * 7,
      }),
    ],
  }),
};

/**
 * Cachés de ejecución que usa esta versión del SW. Todo lo demás (salvo el precache) se borra al
 * activarse: las páginas y RSC que guardaba el `defaultCache` (`pages`, `pages-rsc`,
 * `pages-rsc-prefetch`, `others`, `cross-origin`…) y la fuente de iconos vieja de Google Fonts
 * (`ecos-google-fonts-webfonts`, 4 MB), que ya no se usa desde que la fuente es propia.
 */
const RUNTIME_CACHES = new Set(["ecos-static", "ecos-images", "next-image"]);

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
  runtimeCaching: [navigations, nextStatic, imageCacheFirst, nextImage],
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

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !name.startsWith("serwist-precache") && !RUNTIME_CACHES.has(name))
          .map((name) => caches.delete(name))
      );
    })()
  );
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
