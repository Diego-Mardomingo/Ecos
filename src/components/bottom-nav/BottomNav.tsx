"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
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
  useProfile,
} from "@/lib/hooks/queries";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { getMadridDate } from "@/lib/date-utils";

interface NavItem {
  href: string;
  labelKey: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/ranking", labelKey: "ranking", icon: "leaderboard" },
  { href: "/", labelKey: "play", icon: "play_circle" },
  { href: "/profile", labelKey: "profile", icon: "person" },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("nav");
  const user = useAuthStore((s) => s.user);
  const { data } = useProfile(user?.id ?? null, undefined, { enabled: !!user });

  // Normalizar pathname quitando el prefijo de locale (/en/... → /...)
  const normalizedPath = pathname.replace(/^\/(es|en)/, "") || "/";

  const isActive = (href: string) => {
    if (href === "/") return normalizedPath === "/";
    return normalizedPath.startsWith(href);
  };

  useEffect(() => {
    // Mantener Home prefetcheada reduce el delay al volver desde otras secciones.
    router.prefetch("/");
  }, [router]);

  return (
    <nav className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 border-t-[3px] border-brand/45 bg-card">
      {/* Blob verde sutil centrado en Inicio */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/8 blur-[50px]"
        aria-hidden
      />
      <div className="relative flex justify-around px-2 pt-2 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const label =
            item.labelKey === "profile" && user
              ? (data?.profile?.display_name ?? t("profile"))
              : t(item.labelKey);

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              className="flex min-w-0 flex-1 flex-col items-center gap-0"
              onClick={(e) => {
                if (active) {
                  e.preventDefault();
                  window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
                  sessionStorage.setItem(`scroll:${pathname}`, "0");
                  return;
                }

                if (item.href === "/") {
                  const monthKey = getMadridDate().slice(0, 7);
                  const uid = user?.id ?? null;
                  void queryClient.prefetchQuery({
                    queryKey: queryKeys.home.today(uid),
                    queryFn: fetchHomeTodayData,
                    staleTime: HOME_TODAY_STALE_MS,
                  });
                  void queryClient.prefetchQuery({
                    queryKey: queryKeys.home.previousDays(monthKey, uid),
                    queryFn: () => fetchHomePreviousDaysData(monthKey),
                    staleTime: HOME_PREVIOUS_DAYS_STALE_MS,
                    gcTime: HOME_PREVIOUS_DAYS_GC_MS,
                  });
                  if (uid) {
                    void queryClient.prefetchQuery({
                      queryKey: queryKeys.home.userStats(uid),
                      queryFn: fetchHomeUserStatsData,
                      staleTime: HOME_TODAY_STALE_MS,
                    });
                  }
                }

                if (item.href === "/ranking") {
                  for (const period of ["weekly", "monthly", "global"] as const) {
                    void queryClient.prefetchQuery({
                      queryKey: queryKeys.ranking.period(period),
                      queryFn: () => fetchLeaderboardPeriodData(period),
                      staleTime: RANKING_STALE_MS,
                    });
                  }
                }

                if (item.href === "/profile" && user) {
                  void queryClient.prefetchQuery({
                    queryKey: queryKeys.profile.section("core", user.id),
                    queryFn: fetchProfileCoreData,
                    staleTime: PROFILE_STALE_MS,
                  });
                  void queryClient.prefetchQuery({
                    queryKey: queryKeys.profile.section("stats", user.id),
                    queryFn: fetchProfileStatsData,
                    staleTime: PROFILE_STALE_MS,
                  });
                }
              }}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center leading-none sm:h-11 sm:w-11 [--bottom-nav-icon:28px] sm:[--bottom-nav-icon:34px]"
              >
                <motion.span
                  whileTap={{ scale: 0.85 }}
                  className={cn(
                    "material-symbols-outlined leading-none transition-colors",
                    active ? "text-brand" : "text-muted-foreground"
                  )}
                  style={{
                    fontSize: "var(--bottom-nav-icon)",
                    fontVariationSettings: "'FILL' 1, 'wght' 500, 'opsz' 28",
                  }}
                >
                  {item.icon}
                </motion.span>
              </div>
              <span
                className={cn(
                  "max-w-full -translate-y-0.5 truncate px-0.5 pb-px text-center text-xs font-medium leading-tight transition-colors sm:text-sm",
                  active ? "text-brand" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
