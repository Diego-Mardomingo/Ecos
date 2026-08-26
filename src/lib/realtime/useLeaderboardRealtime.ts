"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/hooks/queries";
import { createEventCoalescer } from "./coalesce";

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

    // Basta con invalidar: TanStack Query ya refetchea por su cuenta las queries activas que
    // marca como stale. El refetchQueries que había después duplicaba cada petición.
    const sync = createEventCoalescer(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ranking.all });
    });

    const channel = supabase
      .channel("leaderboard-changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ecos_scores",
        },
        sync.schedule
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ecos_leaderboard",
        },
        sync.schedule
      )
      .subscribe();

    return () => {
      sync.cancel();
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
