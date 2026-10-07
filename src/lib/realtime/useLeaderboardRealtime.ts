"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/hooks/queryKeys";
import { createEventCoalescer } from "./coalesce";
import { RANKING_BROADCAST_EVENT, RANKING_BROADCAST_TOPIC } from "./ranking-channel";

const PERIODS = ["weekly", "monthly", "global"] as const;

/**
 * Ranking en tiempo real: escucha el Broadcast que el servidor emite al cerrarse una partida
 * (`notifyRankingChanged`, en `src/lib/realtime/broadcast-ranking.ts`) y vuelve a pedir el ranking.
 * Por qué Broadcast y no cambios de Postgres: ver `ranking-channel.ts`.
 *
 * - El aviso no lleva datos, solo invalida las queries de los tres periodos; TanStack Query vuelve a
 *   pedir únicamente la que se está viendo (las otras quedan marcadas y se piden al cambiar de pestaña).
 * - Los avisos se agrupan (`createEventCoalescer`): N partidas seguidas no son N recargas.
 * - Con la pestaña oculta no se recarga: se apunta y se hace al volver a verla.
 * - El canal es privado: necesita la política de `realtime.messages` de
 *   `supabase/migrations/20261007130000_ecos_ranking_broadcast.sql`. Sin ella, la suscripción falla
 *   (queda un aviso en consola) y el ranking sigue funcionando, solo que sin avisos en vivo.
 */
export function useLeaderboardRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let pendingWhileHidden = false;

    const refresh = () => {
      if (document.hidden) {
        pendingWhileHidden = true;
        return;
      }
      for (const period of PERIODS) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ranking.period(period) });
      }
    };
    const sync = createEventCoalescer(refresh);

    const handleVisibility = () => {
      if (document.hidden || !pendingWhileHidden) return;
      pendingWhileHidden = false;
      sync.schedule();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Un canal privado necesita el token del socket antes de unirse (sesión, o la anon key).
    supabase.realtime
      .setAuth()
      .then(() => {
        if (cancelled) return;
        channel = supabase
          .channel(RANKING_BROADCAST_TOPIC, { config: { private: true } })
          .on("broadcast", { event: RANKING_BROADCAST_EVENT }, sync.schedule)
          .subscribe((status, err) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              console.warn("Ranking en vivo no disponible:", status, err?.message ?? "");
            }
          });
      })
      .catch((err: unknown) => {
        console.warn("Ranking en vivo no disponible:", err);
      });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      sync.cancel();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
