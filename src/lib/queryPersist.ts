import { defaultShouldDehydrateQuery, type Query } from "@tanstack/react-query";

export const QUERY_CACHE_STORAGE_KEY = "ecos-query-cache";

/**
 * Versión de lo que se guarda en `localStorage` (el `buster` del persister). **Súbela a mano** al
 * cambiar la forma de una query persistida (`queryTypes.ts`) o la lista de abajo: una caché con
 * otro valor se descarta entera al arrancar.
 *
 * Antes era el SHA del commit (`NEXT_PUBLIC_BUILD_ID` no existía), así que cada despliegue vaciaba
 * la caché de todo el mundo aunque no hubiera cambiado nada (PDATA-15).
 */
export const QUERY_CACHE_VERSION = "2026-10-10";

/** Una partida con su lista de intentos: lo único de `game-progress` que vale la pena guardar. */
function hasGuesses(data: unknown): boolean {
  const progress = (data as { progress?: { guesses?: unknown[] } | null } | undefined)?.progress;
  return (progress?.guesses?.length ?? 0) > 0;
}

/**
 * Qué se guarda para el arranque en caliente (PDATA-06). Solo lo pequeño que no trae ya la página:
 *
 * - `home.today` y `home.userStats` (≈1 KB entre las dos).
 * - El núcleo del perfil (nombre y avatar de las barras). Lleva el email: se borra al cerrar
 *   sesión (`clearSessionScopedClientData`).
 * - El progreso de las partidas abiertas en este dispositivo, si tiene intentos. Los resúmenes
 *   sin intentos que siembra la home y los `{ progress: null }` no aportan nada al volver.
 *
 * Fuera: el histórico de la home (viaja entero en el RSC de cada visita), el estado por día (se
 * deriva del histórico; era el 63 % de lo guardado) y todo lo que no ha terminado bien (`pending`,
 * `error`), que antes también se guardaba porque este filtro sustituía al de por defecto.
 */
export function shouldPersistQuery(query: Query): boolean {
  if (!defaultShouldDehydrateQuery(query)) return false;
  const [root, kind, detail] = query.queryKey;
  switch (root) {
    case "home":
      return kind === "today" || kind === "user-stats";
    case "profile":
      return kind === "section" && detail === "core";
    case "game-progress":
      return hasGuesses(query.state.data);
    default:
      return false;
  }
}
