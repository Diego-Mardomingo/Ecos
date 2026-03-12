"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Porcentaje de aciertos de la canción de hoy, actualizado en tiempo real.
 * Usa la API (público) para que funcione con usuarios no autenticados.
 * Escucha INSERT en ecos_scores para refrescar al recibir nuevas puntuaciones.
 */
export function useTodaysWinRate(gameId: string | null) {
  const [winRate, setWinRate] = useState<number | null>(null);
  const [total, setTotal] = useState(0);

  const fetchWinRate = useCallback(async () => {
    if (!gameId) return;
    try {
      const res = await fetch(`/api/win-rate?gameId=${encodeURIComponent(gameId)}`);
      if (!res.ok) return;
      const { winRate: wr, total: t } = await res.json();
      setTotal(t ?? 0);
      setWinRate(wr ?? null);
    } catch {
      /* ignore */
    }
  }, [gameId]);

  useEffect(() => {
    if (!gameId) {
      setWinRate(null);
      setTotal(0);
      return;
    }
    fetchWinRate();
    const supabase = createClient();
    const channel = supabase
      .channel(`win-rate-${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ecos_scores",
          filter: `game_id=eq.${gameId}`,
        },
        fetchWinRate
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, fetchWinRate]);

  return { winRate, total };
}
