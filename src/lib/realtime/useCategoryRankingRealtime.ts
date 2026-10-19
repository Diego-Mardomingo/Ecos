"use client";

import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/hooks/queryKeys";
import { CATEGORY_RANKING_BROADCAST_EVENT, categoryRankingTopic } from "./ranking-channel";
import { useRealtimeRefresh } from "./useRealtimeRefresh";

/**
 * Clasificación de una categoría en tiempo real: escucha el Broadcast que el servidor emite al
 * terminar una partida de esa categoría con puntos (`notifyCategoryRankingChanged`, en
 * `broadcast-ranking.ts`) y vuelve a pedir la clasificación. Invalida por prefijo de categoría,
 * así que da igual el usuario con el que se sembró la clave.
 *
 * La política de `realtime.messages` está en
 * `supabase/migrations/20261019120000_ecos_category_ranking_broadcast.sql`.
 */
export function useCategoryRankingRealtime(slug: string) {
  const queryClient = useQueryClient();

  useRealtimeRefresh(categoryRankingTopic(slug), CATEGORY_RANKING_BROADCAST_EVENT, () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.categories.rankingOf(slug) });
  });
}
