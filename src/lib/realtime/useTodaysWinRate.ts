"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Porcentaje de aciertos de la canción de hoy, actualizado en tiempo real.
 * Usa la API (público) para que funcione con usuarios no autenticados.
 * Escucha INSERT en ecos_scores para refrescar al recibir nuevas puntuaciones.
 */
/** Resultado anclado al gameId que lo produjo, para no mostrar datos de otra partida. */
type WinRateState = { gameId: string; winRate: number | null; total: number };

export function useTodaysWinRate(gameId: string | null) {
  const [state, setState] = useState<WinRateState | null>(null);

  const fetchWinRate = useCallback(async () => {
    if (!gameId) return;
    try {
      const res = await fetch(`/api/win-rate?gameId=${encodeURIComponent(gameId)}`);
      if (!res.ok) return;
      const { winRate: wr, total: t } = await res.json();
      setState({ gameId, winRate: wr ?? null, total: t ?? 0 });
    } catch {
      /* ignore */
    }
  }, [gameId]);

  useEffect(() => {
    if (!gameId) return;
    // La carga inicial se lanza desde un callback y no desde el cuerpo del efecto,
    // para no encadenar un render síncrono al montar.
    const raf = requestAnimationFrame(() => void fetchWinRate());
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
      cancelAnimationFrame(raf);
      supabase.removeChannel(channel);
    };
  }, [gameId, fetchWinRate]);

  // Derivado en render, no sincronizado por efecto: si no hay gameId, o el dato
  // guardado es de una partida anterior, se descarta en lugar de mostrarse stale.
  const current = gameId && state?.gameId === gameId ? state : null;
  return { winRate: current?.winRate ?? null, total: current?.total ?? 0 };
}
