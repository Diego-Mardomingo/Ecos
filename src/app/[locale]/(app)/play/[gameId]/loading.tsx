import { GameLoadingFallback } from "@/components/game/GameLoadingFallback";

/** UI de carga mientras llega el RSC de `/play/[gameId]` (navegación cliente). */
export default function PlayGameLoading() {
  return <GameLoadingFallback />;
}
