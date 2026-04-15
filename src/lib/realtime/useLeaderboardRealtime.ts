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
    const syncRanking = async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.ranking.all,
      });
      await queryClient.refetchQueries({
        queryKey: queryKeys.ranking.all,
        type: "active",
      });
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
        () => {
          void syncRanking();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ecos_leaderboard",
        },
        () => {
          void syncRanking();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
