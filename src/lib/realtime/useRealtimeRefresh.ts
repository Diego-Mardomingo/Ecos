"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { createEventCoalescer } from "./coalesce";

/**
 * Escucha un Broadcast privado de Supabase Realtime y llama a `onRefresh` cuando llega el aviso.
 * Es la base de los rankings en vivo (diario y por categoría); los canales están en
 * `ranking-channel.ts`.
 *
 * - El aviso no lleva datos: `onRefresh` suele invalidar queries para volver a pedirlas.
 * - Los avisos se agrupan (`createEventCoalescer`): N avisos seguidos no son N recargas.
 * - Con la pestaña oculta no se recarga: se apunta y se hace al volver a verla.
 * - El canal es privado: necesita su política de `realtime.messages`. Sin ella, la suscripción
 *   falla (queda un aviso en consola) y la pantalla sigue funcionando, solo que sin avisos en vivo.
 *
 * `onRefresh` se guarda en un ref (espejo de callbacks) para que cambiarlo entre renders no cierre
 * y reabra el canal: el efecto solo depende del tema y del evento.
 */
export function useRealtimeRefresh(topic: string, event: string, onRefresh: () => void) {
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

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
      onRefreshRef.current();
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
          .channel(topic, { config: { private: true } })
          .on("broadcast", { event }, sync.schedule)
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
  }, [topic, event]);
}
