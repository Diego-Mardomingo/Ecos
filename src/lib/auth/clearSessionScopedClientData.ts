import { useGameProgressStore } from "@/lib/store/gameProgressStore";
import { useGameStore } from "@/lib/store/gameStore";
import { QUERY_CACHE_STORAGE_KEY } from "@/lib/queryPersist";

const GAME_PROGRESS_KEY = "ecos-game-progress";
const GAME_STATE_KEY = "ecos-game-state";
const QUERY_CACHE_USER_KEY = "ecos-query-cache-user-id";

/**
 * Limpia caché de partida local (invitado) al cambiar de sesión para no mezclar
 * progreso con cuenta.
 */
export function clearSessionScopedClientData(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(GAME_PROGRESS_KEY);
    localStorage.removeItem(GAME_STATE_KEY);
    localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
    localStorage.removeItem(QUERY_CACHE_USER_KEY);
  } catch {
    // ignore
  }
  useGameProgressStore.setState({ byGameId: {} });
  useGameStore.getState().resetGame();
}

export function syncCachedSessionUser(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!userId) {
      localStorage.removeItem(QUERY_CACHE_USER_KEY);
      return;
    }
    localStorage.setItem(QUERY_CACHE_USER_KEY, userId);
  } catch {
    // ignore
  }
}

export function getCachedSessionUser(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(QUERY_CACHE_USER_KEY);
  } catch {
    return null;
  }
}
