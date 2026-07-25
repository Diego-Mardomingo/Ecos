"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/hooks/queries";

/**
 * Suscripción a cambios para actualizar el ranking en tiempo real.
 * Escucha INSERT en ecos_scores (nueva puntuación) — más fiable porque ecos_scores es tabla.
 * Si ecos_leaderboard es tabla (no vista), también escucha UPDATE.
 * Migración: ALTER PUBLICATION supabase_realtime ADD TABLE ecos_scores;
 */
export function useLeaderboardRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createClient();

    // Debounce: en hora punta llegan muchos INSERT de ecos_scores casi a la vez
    // (todo el mundo terminando el reto del día). Agrupamos en una sola recarga.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSync = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void queryClient
          .invalidateQueries({ queryKey: queryKeys.ranking.all })
          .then(() =>
            queryClient.refetchQueries({
              queryKey: queryKeys.ranking.all,
              type: "active",
            })
          );
      }, 4000);
    };

    const channel = supabase
      .channel("leaderboard-changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ecos_scores",
        },
        scheduleSync
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ecos_leaderboard",
        },
        scheduleSync
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
