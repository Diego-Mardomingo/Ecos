/**
 * Registro central de claves de TanStack Query y sus ventanas de frescura.
 *
 * Vive en su propio fichero porque es el punto que hay que tocar al añadir una query, y estaba
 * enterrado en la cabecera de `queries.ts`. **Las claves nuevas van aquí**, no inventadas en el
 * sitio de uso: es lo que permite que el parcheado de caché de `gameCacheSync.ts` acierte.
 */

/** Home «today» / «previous-days»: ventana corta para volver desde otras rutas sin refetch constante. */
export const HOME_TODAY_STALE_MS = 3 * 60 * 1000;
export const HOME_PREVIOUS_DAYS_STALE_MS = 3 * 60 * 1000;
/** Muchas claves mensuales: evitar el gcTime global corto (10 min) para no descartar el histórico prefetch. */
export const HOME_PREVIOUS_DAYS_GC_MS = 24 * 60 * 60 * 1000;
/** Estado por día en la lista: alineado con home; evita refetch al expandir mes. */
export const HOME_DAY_STATUS_STALE_MS = 3 * 60 * 1000;
/** Ranking social: fresco, pero evitando refetch excesivo al navegar entre tabs. */
export const RANKING_STALE_MS = 2 * 60 * 1000;
/** Perfil: datos de usuario relativamente estables durante una sesión. */
export const PROFILE_STALE_MS = 3 * 60 * 1000;

/** Segmento estable en query keys para invitado vs usuario autenticado. */
export function homeSessionSegment(userId: string | null): string {
  return userId ?? "guest";
}

export const queryKeys = {
  home: {
    all: (userId: string | null) =>
      ["home", "all", homeSessionSegment(userId)] as const,
    today: (userId: string | null) =>
      ["home", "today", homeSessionSegment(userId)] as const,
    previousDaysAll: (userId: string | null) =>
      ["home", "previous-days", "all", homeSessionSegment(userId)] as const,
    previousDays: (monthKey: string, userId: string | null) =>
      ["home", "previous-days", monthKey, homeSessionSegment(userId)] as const,
    dayStatus: (gameId: string) => ["home", "day-status", gameId] as const,
    userStats: (userId: string | null) =>
      ["home", "user-stats", userId ?? "guest"] as const,
  },
  game: {
    all: ["game"] as const,
    byId: (id: string) => ["game", id] as const,
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
