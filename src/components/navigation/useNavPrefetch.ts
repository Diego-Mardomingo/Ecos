"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/authStore";
import {
  fetchLeaderboardPeriodData,
  homeUserStatsQueryOptions,
  profileCoreQueryOptions,
  profileStatsQueryOptions,
  queryKeys,
  RANKING_STALE_MS,
} from "@/lib/hooks/queries";
import { usePathname } from "@/i18n/navigation";
import { hasRecentGameCompleted } from "@/lib/consistencySync";
import { stripLocalePrefix } from "@/i18n/locale-path";

/** Ventana tras terminar una partida en la que los datos de home/ranking/perfil se dan por viejos. */
const RECENT_COMPLETION_WINDOW_MS = 2 * 60 * 1000;

/**
 * Comportamiento común de las pestañas de navegación (barra inferior y lateral).
 *
 * Estaba copiado entero en `BottomNav` y `SidebarNav`:
 * - `isActive`: qué pestaña corresponde a la ruta actual.
 * - `handleNavClick`: pulsar la pestaña activa sube al principio; pulsar otra precarga sus datos
 *   para que la página llegue con la caché ya llena. Si se acaba de terminar una partida, los
 *   datos se piden frescos (`staleTime: 0`), porque puntos, ranking y estadísticas han cambiado.
 *
 * Para «Inicio» solo se precargan las estadísticas: «hoy» y el histórico llegan en el RSC de la
 * propia página, que la home adopta en caché. Antes se pedía además el mes en curso por API, y esa
 * respuesta (que dice que hay meses anteriores) era la que disparaba el recorrido de todo el
 * histórico mes a mes al volver a la home (PDATA-05).
 */
export function useNavPrefetch() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const normalizedPath = stripLocalePrefix(pathname);

  const isActive = useCallback(
    (href: string) => (href === "/" ? normalizedPath === "/" : normalizedPath.startsWith(href)),
    [normalizedPath]
  );

  const handleNavClick = useCallback(
    (href: string, e: React.MouseEvent) => {
      if (isActive(href)) {
        e.preventDefault();
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
        sessionStorage.setItem(`scroll:${pathname}`, "0");
        return;
      }

      const uid = user?.id ?? null;
      const fresh = hasRecentGameCompleted(uid, RECENT_COMPLETION_WINDOW_MS);

      if (href === "/" && uid) {
        const options = homeUserStatsQueryOptions(uid);
        void queryClient.prefetchQuery({
          ...options,
          staleTime: fresh ? 0 : options.staleTime,
        });
      }

      if (href === "/ranking") {
        if (fresh) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.ranking.all });
        }
        for (const period of ["weekly", "monthly", "global"] as const) {
          void queryClient.prefetchQuery({
            queryKey: queryKeys.ranking.period(period),
            queryFn: () => fetchLeaderboardPeriodData(period),
            staleTime: fresh ? 0 : RANKING_STALE_MS,
          });
        }
      }

      if (href === "/profile" && user) {
        void queryClient.prefetchQuery(profileCoreQueryOptions(user.id));
        const statsOptions = profileStatsQueryOptions(user.id);
        void queryClient.prefetchQuery({
          ...statsOptions,
          staleTime: fresh ? 0 : statsOptions.staleTime,
        });
      }
    },
    [isActive, pathname, queryClient, user]
  );

  return { isActive, handleNavClick };
}
