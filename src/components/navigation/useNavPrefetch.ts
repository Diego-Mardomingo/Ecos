"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/authStore";
import {
  fetchLeaderboardPeriodData,
  fetchHomePreviousDaysData,
  fetchHomeTodayData,
  fetchHomeUserStatsData,
  fetchProfileCoreData,
  fetchProfileStatsData,
  HOME_PREVIOUS_DAYS_GC_MS,
  HOME_PREVIOUS_DAYS_STALE_MS,
  HOME_TODAY_STALE_MS,
  PROFILE_STALE_MS,
  queryKeys,
  RANKING_STALE_MS,
} from "@/lib/hooks/queries";
import { usePathname } from "@/i18n/navigation";
import { getMadridDate } from "@/lib/date-utils";
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

      if (href === "/") {
        const monthKey = getMadridDate().slice(0, 7);
        void queryClient.prefetchQuery({
          queryKey: queryKeys.home.today(uid),
          queryFn: fetchHomeTodayData,
          staleTime: fresh ? 0 : HOME_TODAY_STALE_MS,
        });
        void queryClient.prefetchQuery({
          queryKey: queryKeys.home.previousDays(monthKey, uid),
          queryFn: () => fetchHomePreviousDaysData(monthKey),
          staleTime: fresh ? 0 : HOME_PREVIOUS_DAYS_STALE_MS,
          gcTime: HOME_PREVIOUS_DAYS_GC_MS,
        });
        if (uid) {
          void queryClient.prefetchQuery({
            queryKey: queryKeys.home.userStats(uid),
            queryFn: fetchHomeUserStatsData,
            staleTime: fresh ? 0 : HOME_TODAY_STALE_MS,
          });
        }
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
        void queryClient.prefetchQuery({
          queryKey: queryKeys.profile.section("core", user.id),
          queryFn: fetchProfileCoreData,
          staleTime: PROFILE_STALE_MS,
        });
        void queryClient.prefetchQuery({
          queryKey: queryKeys.profile.section("stats", user.id),
          queryFn: fetchProfileStatsData,
          staleTime: fresh ? 0 : PROFILE_STALE_MS,
        });
      }
    },
    [isActive, pathname, queryClient, user]
  );

  return { isActive, handleNavClick };
}
