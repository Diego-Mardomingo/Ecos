import type {
  GameProgressData,
  HomeDayStatusData,
  HomeTodayData,
  HomeUserStatsData,
  ProfileCoreData,
  ProfileStatsData,
  RankingData,
} from "./queryTypes";

/**
 * Fetchers contra las route handlers. Son envoltorios de `fetch` sin ninguna dependencia, y viven
 * aparte para romper el ciclo entre `queries.ts` y `gameCacheSync.ts`: el parcheado de caché
 * necesita algunos de ellos, y `queries.ts` necesita el parcheado.
 */

/**
 * Respuesta no-ok de una route handler. Lleva el código HTTP para que quien la muestre pueda
 * elegir un mensaje traducido (sesión caducada, error del servidor…) en vez de enseñar el texto
 * en inglés que devuelve la API.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Envía JSON y devuelve el JSON de la respuesta. Si no es ok lanza `ApiError` con el `error` del
 * cuerpo o, si no lo hay, con `fallbackMessage`. El cuerpo se lee con tolerancia: un 502 de la
 * plataforma llega en HTML, y antes eso acababa en un `SyntaxError` como mensaje de error.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  fallbackMessage: string,
  method: "POST" | "PATCH" = "POST"
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!res.ok) {
    throw new ApiError(
      typeof data?.error === "string" ? data.error : fallbackMessage,
      res.status
    );
  }
  return (data ?? {}) as T;
}

export async function fetchProfileCoreData(): Promise<ProfileCoreData> {
  const res = await fetch("/api/profile/core");
  if (!res.ok) throw new Error("Failed to fetch profile core");
  return res.json();
}

export async function fetchProfileStatsData(): Promise<ProfileStatsData> {
  const res = await fetch("/api/profile/stats");
  if (!res.ok) throw new Error("Failed to fetch profile stats");
  return res.json();
}

export async function fetchGameProgressById(
  gameId: string
): Promise<GameProgressData> {
  const res = await fetch(`/api/game-progress/${gameId}`, { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 401 || res.status === 404) {
      return { progress: null };
    }
    throw new Error("Failed to fetch game progress");
  }
  return res.json();
}

export async function fetchHomeTodayData(): Promise<HomeTodayData> {
  const res = await fetch("/api/home/today", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch home today data");
  return res.json();
}

export async function fetchHomeUserStatsData(): Promise<HomeUserStatsData> {
  const res = await fetch("/api/home/user-stats", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch home user stats");
  return res.json();
}

export async function fetchHomeDayStatusById(
  gameId: string
): Promise<HomeDayStatusData> {
  const res = await fetch(`/api/home/day/${gameId}/status`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch day status");
  return res.json();
}

export async function fetchLeaderboardPeriodData(
  period: "weekly" | "monthly" | "global"
): Promise<RankingData> {
  const res = await fetch(`/api/ranking?period=${period}`);
  if (!res.ok) throw new Error("Failed to fetch leaderboard");
  return res.json();
}
