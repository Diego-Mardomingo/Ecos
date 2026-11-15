"use client";

import { useEffect } from "react";
import Script from "next/script";
import { identifySession, onTrackerLoad, type Sesion } from "@/lib/analytics/track";
import { useAuthStore } from "@/lib/store/authStore";
import { BEFORE_SEND_NAME, BEFORE_SEND_SOURCE } from "./umamiBeforeSend";

/** ID del sitio en Umami Cloud (público: va en el HTML de todas formas). */
const UMAMI_WEBSITE_ID = "fe98e76e-e96c-4484-9072-3f23f65a7181";

/**
 * Único dominio que envía datos. El tracker compara literalmente con `location.hostname`, así que
 * las previews de Vercel y localhost no registran nada (pero `window.umami` existe igual y
 * `track()` no falla). Si el sitio cambia de dominio, cámbialo aquí y en el panel de Umami.
 */
const UMAMI_DOMAINS = "ecosgame.vercel.app";

/** Sesión del estado de autenticación del cliente; `null` mientras no se sabe (`AuthProvider`). */
function selectSession(state: { user: unknown; loading: boolean }): Sesion | null {
  if (state.loading) return null;
  return state.user ? "usuario" : "invitado";
}

/**
 * Analítica de Umami Cloud.
 *
 * Tracker en `afterInteractive`: se inserta tras la hidratación, así que no compite con el LCP ni
 * con el JS de la app, pero llega a tiempo de ver el primer pageview y los errores de después de
 * hidratar. (`lazyOnload` lo retrasaría hasta que el navegador esté ocioso y perdería errores.)
 * Los Web Vitals no se pierden por cargar tarde: el tracker lee las métricas con observadores
 * `buffered`.
 *
 * Qué filtra y reescribe el `before-send` (descarte de `/admin`, solo `utm_*` de la query, errores
 * de extensiones), en `umamiBeforeSend.ts`. Se define en un script inline `beforeInteractive`: el
 * tracker busca `window[data-before-send]` en cada envío, no al arrancar, y no envía nada sin haber
 * descargado y ejecutado su script, pero así no se depende de ese orden: Next lo inyecta en el
 * HTML del servidor y se ejecuta antes que cualquier JS de la app o que el tracker, que se inserta
 * mucho después. Es compatible con la CSP actual, que ya tiene `'unsafe-inline'` en `script-src`
 * (ver `next.config.ts`). `beforeInteractive` solo funciona en el layout raíz, y este componente se
 * monta ahí. Vive en `src/app/` y no en `components/` porque la regla de lint
 * `no-before-interactive-script-outside-document` solo exime a los ficheros dentro de `app/`.
 *
 * Sin `data-exclude-search`: el `before-send` ya quita la query salvo los `utm_*`.
 *
 * Datos de sesión (`identify`): es componente de cliente para leer `useAuthStore` y para pasar
 * `onLoad` al tracker, porque el estado de sesión o el tracker pueden llegar primero (ver
 * `identifySession`). El estado de sesión solo se rellena dentro de `(app)` (ahí está
 * `AuthProvider`); en login y en `/admin` queda «cargando» y no se envía nada. Entrar es siempre
 * una recarga completa (One Tap y OAuth) y se vuelve a identificar; cerrar sesión no recarga
 * (`router.replace`), pero cambia el estado, así que el efecto identifica de nuevo.
 */
export function UmamiScript() {
  const sesion = useAuthStore(selectSession);

  useEffect(() => {
    if (sesion) identifySession(sesion);
  }, [sesion]);

  return (
    <>
      <Script id="umami-before-send" strategy="beforeInteractive">
        {BEFORE_SEND_SOURCE}
      </Script>
      <Script
        src="https://cloud.umami.is/script.js"
        strategy="afterInteractive"
        data-website-id={UMAMI_WEBSITE_ID}
        data-domains={UMAMI_DOMAINS}
        data-errors="true"
        data-performance="true"
        data-before-send={BEFORE_SEND_NAME}
        onLoad={onTrackerLoad}
      />
    </>
  );
}
