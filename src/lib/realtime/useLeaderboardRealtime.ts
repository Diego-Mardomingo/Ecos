"use client";

import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/hooks/queryKeys";
import { RANKING_BROADCAST_EVENT, RANKING_BROADCAST_TOPIC } from "./ranking-channel";
import { useRealtimeRefresh } from "./useRealtimeRefresh";

const PERIODS = ["weekly", "monthly", "global"] as const;

/**
 * Ranking diario en tiempo real: escucha el Broadcast que el servidor emite al cerrarse una partida
 * (`notifyRankingChanged`, en `src/lib/realtime/broadcast-ranking.ts`) y vuelve a pedir el ranking.
 * Por qué Broadcast y no cambios de Postgres: ver `ranking-channel.ts`. El resto del comportamiento
 * (agrupar avisos, pestaña oculta, canal privado) vive en `useRealtimeRefresh`.
 *
 * El aviso invalida las queries de los tres periodos; TanStack Query vuelve a pedir únicamente la
 * que se está viendo (las otras quedan marcadas y se piden al cambiar de pestaña).
 *
 * La política de `realtime.messages` está en
 * `supabase/migrations/20261007130000_ecos_ranking_broadcast.sql`.
 */
export function useLeaderboardRealtime() {
  const queryClient = useQueryClient();

  useRealtimeRefresh(RANKING_BROADCAST_TOPIC, RANKING_BROADCAST_EVENT, () => {
    for (const period of PERIODS) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ranking.period(period) });
    }
  });
}
