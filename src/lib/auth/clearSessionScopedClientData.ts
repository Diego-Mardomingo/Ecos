import { useGameProgressStore } from "@/lib/store/gameProgressStore";
import { useGameStore } from "@/lib/store/gameStore";

const GAME_PROGRESS_KEY = "ecos-game-progress";
const GAME_STATE_KEY = "ecos-game-state";

/**
 * Limpia caché de partida local (invitado) al cambiar de sesión para no mezclar
 * progreso con cuenta.
 */
export function clearSessionScopedClientData(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(GAME_PROGRESS_KEY);
    localStorage.removeItem(GAME_STATE_KEY);
  } catch {
    // ignore
  }
  useGameProgressStore.setState({ byGameId: {} });
  useGameStore.getState().resetGame();
}
