import Script from "next/script";

/** ID del sitio en Umami Cloud (público: va en el HTML de todas formas). */
const UMAMI_WEBSITE_ID = "fe98e76e-e96c-4484-9072-3f23f65a7181";

/**
 * Único dominio que envía datos. El tracker compara literalmente con `location.hostname`, así que
 * las previews de Vercel y localhost no registran nada (pero `window.umami` existe igual y
 * `track()` no falla). Si el sitio cambia de dominio, cámbialo aquí y en el panel de Umami.
 */
const UMAMI_DOMAINS = "ecosgame.vercel.app";

/** Nombre de la función global que el tracker consulta antes de cada envío (`data-before-send`). */
const BEFORE_SEND_NAME = "ecosUmamiBeforeSend";

/**
 * Va con `String.raw`: en una plantilla normal, `\/` se convertiría en `/` y la expresión regular
 * del script saldría rota.
 *
 * Descarta todo lo que venga del panel `/admin` (también `/en/admin`), sea del tipo que sea
 * (`event`, `performance`, `error`, `identify`). El panel es privado y no debe aparecer en las
 * estadísticas. Detalles verificados en el tracker de Umami:
 *  - en eventos y rendimiento `payload.url` es una URL absoluta; en errores, solo la ruta. Por eso
 *    se normaliza con `new URL(url, location.origin).pathname` en vez de comparar el prefijo.
 *  - si el tracker no encuentra la función, envía todo sin filtrar (falla abierto); de ahí que se
 *    defina en un script inline `beforeInteractive`, ver `UmamiScript`.
 *  - si la URL no se puede interpretar, se descarta (falla cerrado); sin `url`, se deja pasar.
 */
const BEFORE_SEND_SOURCE = String.raw`window.${BEFORE_SEND_NAME}=function(type,payload){try{if(payload&&payload.url){var path=new URL(payload.url,location.origin).pathname;if(/^(\/en)?\/admin(\/|$)/.test(path))return null}}catch(e){return null}return payload}`;

/**
 * Analítica de Umami Cloud.
 *
 * Tracker en `afterInteractive`: se inserta tras la hidratación, así que no compite con el LCP ni
 * con el JS de la app, pero llega a tiempo de ver el primer pageview y los errores de después de
 * hidratar. (`lazyOnload` lo retrasaría hasta que el navegador esté ocioso y perdería errores.)
 * Los Web Vitals no se pierden por cargar tarde: el tracker lee las métricas con observadores
 * `buffered`.
 *
 * Cuándo se define `before-send`: el tracker busca `window[data-before-send]` en cada envío, no al
 * arrancar, y no envía nada sin haber descargado y ejecutado su script. Aun así, para no depender
 * de ese orden, la función se define en un script inline `beforeInteractive`: Next lo inyecta en el
 * `<head>` del HTML del servidor y se ejecuta antes que cualquier JS de la app o que el tracker,
 * que se inserta mucho después. Es compatible con la CSP actual, que ya tiene `'unsafe-inline'`
 * en `script-src` (ver `next.config.ts`). `beforeInteractive` solo funciona en el layout raíz,
 * y este componente se monta ahí. Vive en `src/app/` y no en `components/` porque la regla de lint
 * `no-before-interactive-script-outside-document` solo exime a los ficheros dentro de `app/`.
 */
export function UmamiScript() {
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
        data-exclude-search="true"
        data-errors="true"
        data-performance="true"
        data-before-send={BEFORE_SEND_NAME}
      />
    </>
  );
}
