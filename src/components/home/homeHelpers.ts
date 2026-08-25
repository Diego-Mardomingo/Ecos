import type { PreviousDayGame } from "@/lib/queries/games";
import type { InProgressProgress } from "@/lib/hooks/queries";

/**
 * Constantes y helpers puros de la home, extraídos de `HomeClient` sin cambiar nada.
 *
 * Aquí solo va lo que no toca React: claves de almacenamiento, topes del prefetch, las funciones
 * de fusión de días y el batching. La lógica derivada de un día concreto vive en
 * `homeDayDerived.ts`.
 */

/** Iconos Material para los pasos del diálogo «Cómo se juega» (mismo orden que `howToPlayStepsList` en i18n). */
export const ABOUT_HOW_TO_PLAY_ICONS = [
  "calendar_today",
  "graphic_eq",
  "search",
  "emoji_events",
  "skip_next",
] as const;
export const PREVIOUS_DAYS_FILTER_STORAGE_KEY = "ecos-previous-days-filter";
export const HOME_MONTHS_OPEN_STORAGE_KEY = "ecos-home-months-open";
export const HOME_VIEW_MODE_STORAGE_KEY = "ecos-home-view-mode";
export const HOME_SORT_ORDER_STORAGE_KEY = "ecos-home-sort-order";
export const HOME_STATS_PERIOD_STORAGE_KEY = "ecos-home-stats-period";

export type PreviousDaysPrefs = {
  openMonths?: Set<string>;
  filterYear?: number;
  filterMonth?: number;
  viewMode?: "list" | "grid";
  sortOrder?: "asc" | "desc";
};

/** Lee de una vez las preferencias de la sección de días anteriores. Cada clave va en
 *  su propio try: un valor corrupto no debe impedir restaurar los demás. */
export function readPreviousDaysPrefs(): PreviousDaysPrefs {
  const prefs: PreviousDaysPrefs = {};
  try {
    const raw = sessionStorage.getItem(HOME_MONTHS_OPEN_STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : null;
    if (Array.isArray(arr) && arr.length > 0) prefs.openMonths = new Set(arr);
  } catch {
    /* ignore */
  }
  try {
    const raw = sessionStorage.getItem(PREVIOUS_DAYS_FILTER_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { filterYear?: number | null; filterMonth?: number | null };
      if (typeof p.filterYear === "number") prefs.filterYear = p.filterYear;
      if (typeof p.filterMonth === "number") prefs.filterMonth = p.filterMonth;
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = sessionStorage.getItem(HOME_VIEW_MODE_STORAGE_KEY);
    if (raw === "list" || raw === "grid") prefs.viewMode = raw;
  } catch {
    /* ignore */
  }
  try {
    const raw = sessionStorage.getItem(HOME_SORT_ORDER_STORAGE_KEY);
    if (raw === "asc" || raw === "desc") prefs.sortOrder = raw;
  } catch {
    /* ignore */
  }
  return prefs;
}
/**
 * Solo red de seguridad si la API devolviera nextMonth de forma errónea.
 * El histórico real termina cuando nextMonth es null.
 */
export const MAX_PREFETCH_HISTORY_MONTHS_SAFETY = 600;
const PREFETCH_BATCH_SIZE = 8;
/**
 * Tope del prefetch eager de partidas. El mes en curso nunca pasa de 31 días, así que esto solo
 * actúa si `previousDaysMerged` llegara con fechas inesperadas.
 */
export const HOME_EAGER_PREFETCH_MAX = 31;
export const HOME_PREFETCH_STRATEGY: "sequential" | "full-parallel" =
  process.env.NEXT_PUBLIC_HOME_PREFETCH_STRATEGY === "sequential"
    ? "sequential"
    : "full-parallel";
/** Colores para días anteriores en orden: rojo, azul, verde (bucle) */
const PREVIOUS_DAY_COLORS = [
  "hsl(0, 55%, 40%)",   /* rojo */
  "hsl(200, 50%, 40%)", /* azul */
  "hsl(140, 45%, 35%)", /* verde */
] as const;

/** Prioridad en next/image solo para las primeras carátulas del histórico (equilibrio con LCP). */
export const HOME_COVER_IMAGE_PRIORITY_COUNT = 16;

export function titleCaseWords(input: string): string {
  return input
    .split(" ")
    .map((token) => (/^\p{L}/u.test(token) ? token[0]!.toUpperCase() + token.slice(1) : token))
    .join(" ");
}
export function mergePreviousDays(
  current: PreviousDayGame[],
  incoming: PreviousDayGame[]
): PreviousDayGame[] {
  if (incoming.length === 0) return current;
  const map = new Map<string, PreviousDayGame>();
  for (const day of current) map.set(day.id, day);
  for (const day of incoming) {
    const existing = map.get(day.id);
    if (!existing) {
      map.set(day.id, day);
      continue;
    }
    /**
     * Evita downgrade visual por snapshots stale:
     * si ya estaba completado y llega un bloque "sin empezar", conservamos completado.
     */
    if (existing.played && !day.played) {
      map.set(day.id, existing);
      continue;
    }
    map.set(day.id, day);
  }
  const merged = [...map.values()].sort((a, b) => b.date.localeCompare(a.date));

  /**
   * Si el resultado es el mismo, devolver la MISMA referencia y no una copia.
   *
   * No es una micro-optimización: es lo que corta un bucle infinito de renders. La home escribe
   * `previousDaysAll` en la caché desde un efecto, una suscripción a la caché reacciona con
   * `setPreviousDaysMerged(mergePreviousDays(...))`, y ese estado es dependencia del efecto. Si
   * aquí se devolviera siempre un array nuevo, el estado cambiaría siempre, el efecto volvería a
   * escribir, y así hasta que React aborta con «Maximum update depth exceeded».
   */
  if (
    merged.length === current.length &&
    merged.every((day, i) => day === current[i])
  ) {
    return current;
  }

  return merged;
}

export function mergeInProgressByGameId(
  current: Record<string, InProgressProgress>,
  incoming?: Record<string, InProgressProgress>
): Record<string, InProgressProgress> {
  if (!incoming) return current;

  // Misma referencia si no aporta nada nuevo, por el mismo motivo que en mergePreviousDays.
  const incomingIds = Object.keys(incoming);
  if (
    incomingIds.length > 0 &&
    incomingIds.every((id) => current[id] === incoming[id])
  ) {
    return current;
  }
  if (incomingIds.length === 0) return current;

  return { ...current, ...incoming };
}

/** Por juego, conserva el mapa con más intentos (caché RQ tras /play vs snapshot RSC). */
export function mergeInProgressPreferringMoreGuesses(
  a: Record<string, InProgressProgress>,
  b: Record<string, InProgressProgress>
): Record<string, InProgressProgress> {
  const out: Record<string, InProgressProgress> = { ...a };
  for (const [id, bProg] of Object.entries(b)) {
    const aProg = out[id];
    if (
      !aProg ||
      (bProg.guesses?.length ?? 0) > (aProg.guesses?.length ?? 0)
    ) {
      out[id] = bProg;
    }
  }
  return out;
}

export function previousDayColor(gameNumber: number): string {
  return PREVIOUS_DAY_COLORS[(gameNumber - 1) % 3];
}

export async function runBatched<T>(
  items: T[],
  worker: (item: T) => Promise<unknown>,
  batchSize: number = PREFETCH_BATCH_SIZE
) {
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await Promise.allSettled(chunk.map((item) => worker(item)));
  }
}
