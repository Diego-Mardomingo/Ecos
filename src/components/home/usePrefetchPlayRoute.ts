"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchGameAudio } from "@/lib/audio/audioStore";
import { prefetchGameProgressById } from "@/lib/hooks/queries";
import { useRouter } from "@/i18n/navigation";

/**
 * Precarga de una partida pasada (`/play/<id>`) cuando el usuario muestra intención de abrirla:
 * pasa el puntero, la toca, la enfoca o la selecciona en el calendario.
 *
 * Además baja el MP3 de la partida (`prefetchGameAudio`: idempotente, y respeta el ahorro de
 * datos): con el audio ya en memoria, al abrir la partida el reproductor está listo al instante.
 *
 * La comparten el carril «Últimos días» y el calendario del archivo, que la tenían copiada. Antes
 * se lanzaba también al entrar cada tarjeta en pantalla (`PrefetchPlayOnVisible`): con el carril
 * visible eran ~8 peticiones RSC por carga de la home sin que nadie tocara nada (PDATA-04). El
 * estado del día ya no se precarga: la home lo saca del histórico y `/play` no lo usa.
 */
export function usePrefetchPlayRoute(userId: string | null) {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useCallback(
    (gameId: string) => {
      router.prefetch(`/play/${gameId}`);
      prefetchGameAudio(gameId, "intención (archivo)");
      if (userId) {
        void prefetchGameProgressById(queryClient, gameId).catch(() => undefined);
      }
    },
    [queryClient, router, userId]
  );
}
