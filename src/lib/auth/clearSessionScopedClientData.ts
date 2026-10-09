import { clearGameAudioStore } from "@/lib/audio/audioStore";
import { useGameProgressStore } from "@/lib/store/gameProgressStore";
import { useGameStore } from "@/lib/store/gameStore";
import { QUERY_CACHE_STORAGE_KEY } from "@/lib/queryPersist";

const GAME_PROGRESS_KEY = "ecos-game-progress";
const GAME_STATE_KEY = "ecos-game-state";
const QUERY_CACHE_USER_KEY = "ecos-query-cache-user-id";

/**
 * Cachés del service worker que pueden guardar respuestas de una sesión. La versión actual del SW
 * (`src/app/sw.ts`) solo guarda estáticos, pero las anteriores guardaban HTML y RSC de páginas
 * autenticadas (`/profile` con el email, la home con el histórico), y siguen ahí hasta que el SW
 * nuevo se activa. Se borra todo menos el precache, que es el mismo para todo el mundo.
 */
async function clearServiceWorkerRuntimeCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => !name.startsWith("serwist-precache"))
      .map((name) => caches.delete(name))
  );
}

/**
 * Borra todo lo que el cliente guarda de una sesión al cambiar de usuario o cerrar sesión: el
 * progreso local de partidas (no mezclar el de invitado con el de la cuenta), la caché de queries
 * persistida, las cachés del service worker (PDATA-02) y los MP3 en memoria de `audioStore`.
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
  void clearServiceWorkerRuntimeCaches().catch(() => undefined);
  useGameProgressStore.setState({ byGameId: {} });
  useGameStore.getState().resetGame();
  clearGameAudioStore();
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
