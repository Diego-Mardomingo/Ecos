import type { Query } from "@tanstack/react-query";
import { getMsUntilNextMidnightMadrid } from "@/lib/date-utils";

/**
 * Registro central de claves de TanStack Query y sus ventanas de frescura.
 *
 * Vive en su propio fichero porque es el punto que hay que tocar al añadir una query, y estaba
 * enterrado en la cabecera de `queries.ts`. **Las claves nuevas van aquí**, no inventadas en el
 * sitio de uso: es lo que permite que el parcheado de caché de `gameCacheSync.ts` acierte.
 *
 * Las opciones completas de cada query (clave + fetcher + frescura) están en `queries.ts`
 * (`homeTodayQueryOptions` y compañía): úsalas también para `prefetchQuery`/`fetchQuery`.
 */

/**
 * Frescura de lo que solo cambia con el día de juego o por jugadas del propio usuario (que ya se
 * parchean en caché): fresco hasta la medianoche de Madrid siguiente a cuando se obtuvo. Antes
 * eran 3 minutos y la home volvía a pedirlo al volver de cualquier pestaña (PDATA-09).
 */
export function staleUntilMadridMidnight(query: Pick<Query, "state">): number {
  const updatedAt = query.state.dataUpdatedAt || Date.now();
  return getMsUntilNextMidnightMadrid(new Date(updatedAt));
}

/** Estadísticas de la home: los puestos dependen también de lo que juegan los demás. */
export const HOME_USER_STATS_STALE_MS = 3 * 60 * 1000;
/** El histórico de la home no se descarta en toda la sesión: lo parchean las jugadas. */
export const HOME_HISTORY_GC_MS = 24 * 60 * 60 * 1000;
/** Ranking social: fresco, pero evitando refetch excesivo al navegar entre tabs. */
export const RANKING_STALE_MS = 2 * 60 * 1000;
/** Perfil: datos de usuario relativamente estables durante una sesión. */
export const PROFILE_STALE_MS = 3 * 60 * 1000;
/** Búsqueda de canciones: el catálogo solo cambia con la ingesta semanal. */
export const SEARCH_STALE_MS = 60 * 60 * 1000;

/** Segmento estable en query keys para invitado vs usuario autenticado. */
export function homeSessionSegment(userId: string | null): string {
  return userId ?? "guest";
}

export const queryKeys = {
  home: {
    today: (userId: string | null) =>
      ["home", "today", homeSessionSegment(userId)] as const,
    /**
     * Histórico completo de la home (todos los días anteriores a hoy), la única fuente de los
     * días pasados en cliente. La siembra el RSC de cada visita y la parchean las jugadas.
     */
    previousDaysAll: (userId: string | null) =>
      ["home", "previous-days", "all", homeSessionSegment(userId)] as const,
    dayStatus: (gameId: string) => ["home", "day-status", gameId] as const,
    userStats: (userId: string | null) =>
      ["home", "user-stats", userId ?? "guest"] as const,
  },
  game: {
    progress: (id: string) => ["game-progress", id] as const,
  },
  ranking: {
    all: ["ranking"] as const,
    period: (period: string) => ["ranking", "period", period] as const,
    historySummaries: (granularity: string) =>
      ["ranking", "history", "summaries", granularity] as const,
    historyDetail: (granularity: string, anchor: string) =>
      ["ranking", "history", "detail", granularity, anchor] as const,
  },
  profile: {
    all: ["profile"] as const,
    section: (section: "core" | "stats", userId: string | null) =>
      ["profile", "section", section, homeSessionSegment(userId)] as const,
  },
  search: (q: string) => ["search", q] as const,
};
