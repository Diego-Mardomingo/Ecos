/**
 * Código del `before-send` del tracker de Umami (`data-before-send`), como texto para un script
 * inline: se ejecuta en el navegador antes de que el tracker envíe nada, así que no puede importar
 * nada. Vive aparte de `UmamiScript.tsx` para poder probarlo en node con casos sueltos.
 *
 * Va con `String.raw`: en una plantilla normal, `\/` se convertiría en `/` y las expresiones
 * regulares saldrían rotas.
 *
 * El tracker lo llama con `(tipo, payload)` y envía lo que devuelva; con un valor falso, descarta.
 * Tipos: `event`, `performance`, `identify` y `error`. Qué hace, por orden:
 *
 *  1. Descarta los `error` de extensiones del navegador (`chrome-extension://`, `moz-extension://`,
 *     `safari-extension://`, `safari-web-extension://`) en `stack` o `message`: no son del sitio.
 *  2. Descarta todo lo que venga del panel `/admin` (también `/en/admin`), sea del tipo que sea. En
 *     eventos y rendimiento `payload.url` es una URL absoluta; en errores, solo la ruta. Por eso se
 *     normaliza con `new URL(url, location.origin).pathname` en vez de comparar el prefijo. Si la
 *     URL no se puede interpretar, se descarta (falla cerrado); sin `url`, se deja pasar.
 *  3. Reescribe `payload.url` y deja de la query solo los `utm_*`. El tracker se configura sin
 *     `data-exclude-search` porque Umami saca las campañas (`utm_source`, `utm_medium`…) de la
 *     query de `url` en el servidor; sin ello se perderían. Así `?audioDebug=1`, `?redirect=` y
 *     cualquier otro parámetro siguen sin entrar. Si la URL era relativa, sale relativa. El `#hash`
 *     también se quita (no se configura `data-exclude-hash`, así que lo haría este código).
 *  4. Hace lo mismo con `payload.referrer`, porque el tracker lo calcula con la URL de la página
 *     anterior, que ya trae la query completa al navegar dentro de la app. Del mismo origen conserva
 *     los `utm_*`; de otro origen, solo `protocolo://host/ruta` (sin query ni hash, como antes).
 *     Si no se puede interpretar, se envía vacío en vez de descartar el evento.
 *
 * Si el tracker no encuentra la función, envía todo sin filtrar (falla abierto); de ahí que se
 * defina en un script inline `beforeInteractive`, ver `UmamiScript`.
 */

/** Nombre de la función global que el tracker consulta antes de cada envío (`data-before-send`). */
export const BEFORE_SEND_NAME = "ecosUmamiBeforeSend";

export const BEFORE_SEND_SOURCE = String.raw`
window.${BEFORE_SEND_NAME} = function (type, payload) {
  var EXTENSION = /(?:chrome|moz|safari|safari-web)-extension:\/\//;
  var ADMIN = /^(\/en)?\/admin(\/|$)/;

  function utmQuery(page) {
    var kept = new URLSearchParams();
    page.searchParams.forEach(function (value, key) {
      if (key.indexOf("utm_") === 0) kept.append(key, value);
    });
    var query = kept.toString();
    return query ? "?" + query : "";
  }

  function cleanUrl(raw, page) {
    var absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    return (absolute ? page.origin : "") + page.pathname + utmQuery(page);
  }

  function cleanReferrer(raw) {
    try {
      var page = new URL(raw, location.origin);
      if (page.origin === location.origin) return cleanUrl(raw, page);
      return page.protocol + "//" + page.host + page.pathname;
    } catch (e) {
      return "";
    }
  }

  try {
    if (!payload) return payload;
    if (type === "error") {
      if (EXTENSION.test(String(payload.stack || "") + "\n" + String(payload.message || ""))) return null;
    }
    if (payload.url) {
      var page = new URL(payload.url, location.origin);
      if (ADMIN.test(page.pathname)) return null;
      payload.url = cleanUrl(payload.url, page);
    }
    if (typeof payload.referrer === "string" && payload.referrer) {
      payload.referrer = cleanReferrer(payload.referrer);
    }
  } catch (e) {
    return null;
  }
  return payload;
};
`;
