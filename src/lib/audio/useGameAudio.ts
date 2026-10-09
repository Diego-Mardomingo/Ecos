"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  acquireGameAudio,
  getGameAudioSnapshot,
  IDLE_GAME_AUDIO,
  loadGameAudio,
  retryGameAudio,
  subscribeGameAudio,
  type GameAudioSnapshot,
} from "@/lib/audio/audioStore";

const noopUnsubscribe = () => {};
const subscribeNothing = () => noopUnsubscribe;
const getIdle = () => IDLE_GAME_AUDIO;

/**
 * Estado del audio de una partida, leído de `audioStore`, y `retry` para volver a resolver y
 * descargar tras un fallo. Con `gameId` indefinido (la canción no tiene audio) no hace nada.
 *
 * Quien lo usa **monta un reproductor**: se anota en la entrada mientras dure, para que el LRU no
 * revoque el Blob que está sonando, y pide la carga (idempotente). Si la entrada vuelve a `idle`
 * (se limpió la caché al cerrar sesión) la vuelve a pedir.
 */
export function useGameAudio(gameId: string | undefined): {
  audio: GameAudioSnapshot;
  retry: () => void;
} {
  const subscribe = useCallback(
    (listener: () => void) => (gameId ? subscribeGameAudio(gameId, listener) : subscribeNothing()),
    [gameId]
  );
  const getSnapshot = useCallback(
    () => (gameId ? getGameAudioSnapshot(gameId) : IDLE_GAME_AUDIO),
    [gameId]
  );
  const audio = useSyncExternalStore(subscribe, getSnapshot, getIdle);
  const isIdle = audio.status === "idle";

  useEffect(() => {
    if (!gameId) return;
    return acquireGameAudio(gameId);
  }, [gameId]);

  useEffect(() => {
    if (!gameId || !isIdle) return;
    void loadGameAudio(gameId);
  }, [gameId, isIdle]);

  const retry = useCallback(() => {
    if (gameId) retryGameAudio(gameId);
  }, [gameId]);

  return { audio, retry };
}
