"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/hooks/queries";

/**
 * Suscripción a cambios en ecos_leaderboard para invalidar el ranking en tiempo real.
 * Requiere que ecos_leaderboard esté en la publicación supabase_realtime.
 * Si ecos_leaderboard es una vista, usar ecos_scores (INSERT) en su lugar.
 */
export function useLeaderboardRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("leaderboard-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ecos_leaderboard",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
