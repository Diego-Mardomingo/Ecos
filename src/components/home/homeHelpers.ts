import type { PreviousDayGame } from "@/lib/queries/games";
import type {
  HomeDayStatusData,
  HomePreviousDaysData,
  HomeTodayData,
  InProgressProgress,
} from "@/lib/hooks/queries";

/**
 * Constantes y helpers puros de la home.
 *
 * Aquí solo va lo que no toca React: claves de almacenamiento y las funciones que combinan lo que
 * llega del servidor con lo que ya hay en caché. La lógica derivada de un día concreto vive en
 * `homeDayDerived.ts`.
 *
 * Todas las fusiones devuelven **la misma referencia** si el resultado no cambia. No es una
 * micro-optimización: con una copia nueva cada vez, cualquier sitio que escriba el resultado en la
 * caché y reaccione a ella entraría en un bucle de renders («Maximum update depth exceeded», que
 * ya pasó con el histórico).
 */

/** Iconos Material para los pasos del diálogo «Cómo se juega» (mismo orden que `howToPlayStepsList` en i18n). */
export const ABOUT_HOW_TO_PLAY_ICONS = [
  "calendar_today",
  "graphic_eq",
  "search",
  "emoji_events",
  "skip_next",
] as const;
export const HOME_STATS_PERIOD_STORAGE_KEY = "ecos-home-stats-period";
/** Mes que se estaba viendo en el calendario del archivo (sessionStorage). */
export const HOME_ARCHIVE_MONTH_STORAGE_KEY = "ecos-home-archive-month";

export function titleCaseWords(input: string): string {
  return input
    .split(" ")
    .map((token) => (/^\p{L}/u.test(token) ? token[0]!.toUpperCase() + token.slice(1) : token))
    .join(" ");
}

function guessCount(p: InProgressProgress | null | undefined): number {
  return p?.guesses?.length ?? 0;
}

/**
 * Une dos listas de días (del más reciente al más antiguo). Gana lo que llega, salvo que un día
 * ya terminado llegue «sin jugar»: eso es una copia vieja (el RSC que el router guarda para el
 * botón atrás, por ejemplo), y una partida terminada no vuelve atrás.
 */
export function mergePreviousDays(
  current: PreviousDayGame[],
  incoming: PreviousDayGame[]
): PreviousDayGame[] {
  if (incoming.length === 0) return current;
  const map = new Map<string, PreviousDayGame>();
  for (const day of current) map.set(day.id, day);
  for (const day of incoming) {
    const existing = map.get(day.id);
    if (existing?.played && !day.played) continue;
    map.set(day.id, day);
  }
  const merged = [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  if (merged.length === current.length && merged.every((day, i) => day === current[i])) {
    return current;
  }
  return merged;
}

/**
 * Partidas a medias del histórico: por juego, la que tenga más intentos, y ninguna de un día que
 * ya figura como terminado (una copia vieja podría volver a traerla).
 */
function mergeHistoryInProgress(
  current: Record<string, InProgressProgress>,
  incoming: Record<string, InProgressProgress> | undefined,
  days: PreviousDayGame[]
): Record<string, InProgressProgress> {
  let next = current;
  for (const [id, progress] of Object.entries(incoming ?? {})) {
    if (guessCount(next[id]) >= guessCount(progress) && next[id]) continue;
    if (next === current) next = { ...current };
    next[id] = progress;
  }
  for (const day of days) {
    if (!day.played || !(day.id in next)) continue;
    if (next === current) next = { ...current };
    delete next[day.id];
  }
  return next;
}

/**
 * Histórico en caché + uno que llega (RSC de la visita, `/api/home`). Ver `mergePreviousDays`
 * para la regla de cada día.
 */
export function mergeHistoryBlock(
  prev: HomePreviousDaysData | undefined,
  incoming: HomePreviousDaysData
): HomePreviousDaysData {
  const prevDays = prev?.previousDays ?? [];
  const prevInProgress = prev?.inProgressByGameId ?? {};
  const previousDays = mergePreviousDays(prevDays, incoming.previousDays ?? []);
  const inProgressByGameId = mergeHistoryInProgress(
    prevInProgress,
    incoming.inProgressByGameId,
    previousDays
  );
  const userId = incoming.userId ?? prev?.userId ?? null;
  if (
    prev &&
    previousDays === prev.previousDays &&
    inProgressByGameId === prev.inProgressByGameId &&
    userId === prev.userId
  ) {
    return prev;
  }
  return { ...prev, previousDays, inProgressByGameId, userId };
}

/**
 * Lleva al histórico el estado de días sueltos (`home.dayStatus`, lo que escribe la partida).
 *
 * - `authoritative`: el estado acaba de llegar del servidor y manda tal cual.
 * - Si no, solo se usa para no ir hacia atrás: un día terminado en el estado se marca terminado,
 *   y una partida a medias con más intentos sustituye a la que hubiera.
 */
export function applyDayStatusesToHistory(
  block: HomePreviousDaysData,
  statuses: HomeDayStatusData[],
  authoritative: boolean
): HomePreviousDaysData {
  let days = block.previousDays;
  let inProgress = block.inProgressByGameId ?? {};
  const original = { days, inProgress };

  for (const status of statuses) {
    const idx = days.findIndex((d) => d.id === status.gameId);
    const row = idx >= 0 ? days[idx] : undefined;

    if (row && (status.played ? authoritative || !row.played : false)) {
      const patched: PreviousDayGame = {
        ...row,
        played: true,
        won: status.won,
        score: status.score,
        title: status.title,
        artist_name: status.artist_name,
        cover_url: status.cover_url,
      };
      const changed = (Object.keys(patched) as Array<keyof PreviousDayGame>).some(
        (k) => patched[k] !== row[k]
      );
      if (changed) {
        if (days === original.days) days = [...days];
        days[idx] = patched;
      }
    }

    const current = inProgress[status.gameId];
    if (status.played || row?.played) {
      if (current) {
        if (inProgress === original.inProgress) inProgress = { ...inProgress };
        delete inProgress[status.gameId];
      }
    } else if (
      status.inProgress &&
      status.inProgress !== current &&
      (authoritative || guessCount(status.inProgress) > guessCount(current))
    ) {
      if (inProgress === original.inProgress) inProgress = { ...inProgress };
      inProgress[status.gameId] = status.inProgress;
    }
  }

  if (days === original.days && inProgress === original.inProgress) return block;
  return { ...block, previousDays: days, inProgressByGameId: inProgress };
}

/**
 * «Hoy» en caché + uno que llega. Gana el día más reciente; dentro del mismo día, una partida
 * terminada no vuelve a «en curso» por una copia vieja (vuelta atrás desde `/play`), y entre dos
 * partidas a medias gana la de más intentos.
 */
export function mergeTodayData(
  prev: HomeTodayData | undefined,
  incoming: HomeTodayData
): HomeTodayData {
  if (!prev) return incoming;
  const prevDate = prev.todaysGame?.date ?? "";
  const incomingDate = incoming.todaysGame?.date ?? "";
  if (prevDate !== incomingDate) return incomingDate > prevDate ? incoming : prev;
  if (incoming.todaysCompletedResult) return incoming;
  if (prev.todaysCompletedResult) return prev;
  return guessCount(prev.todaysInProgress) > guessCount(incoming.todaysInProgress)
    ? prev
    : incoming;
}
