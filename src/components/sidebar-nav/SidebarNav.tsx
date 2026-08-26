"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import Image from "next/image";
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
import { hasRecentGameCompleted } from "@/lib/consistencySync";
import { stripLocalePrefix } from "@/i18n/locale-path";

interface NavItem {
  href: string;
  labelKey: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/ranking", labelKey: "ranking", icon: "leaderboard" },
  { href: "/", labelKey: "play", icon: "play_circle" },
];

function initialFromLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 1).toUpperCase();
}

export function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("nav");
  const user = useAuthStore((s) => s.user);
  const { data } = useProfile(user?.id ?? null, undefined, { enabled: !!user });
  const hasRecentCompletion = hasRecentGameCompleted(
    user?.id ?? null,
    2 * 60 * 1000
  );

  const normalizedPath = stripLocalePrefix(pathname);

  const isActive = (href: string) => {
    if (href === "/") return normalizedPath === "/";
    return normalizedPath.startsWith(href);
  };

  useEffect(() => {
    router.prefetch("/");
  }, [router]);

  const profileLabel = user
    ? (data?.profile?.display_name ?? t("profile"))
    : t("profile");

  const profileInitial = initialFromLabel(profileLabel);

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border/40 bg-card min-[670px]:flex">
      <div className="relative px-4 pt-5 pb-4">
        <div
          className="pointer-events-none absolute -top-10 left-1/2 h-28 w-28 -translate-x-1/2 rounded-full bg-brand/6 blur-[60px]"
          aria-hidden
        />
        <Link href="/" className="relative inline-flex items-center gap-2">
          <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-border/50 bg-background/60 shadow-sm">
            <Image
              src="/ecos_icon_v2.png"
              alt="ECOS"
              width={36}
              height={36}
              className="h-7 w-7"
              priority
            />
          </span>
          <span className="text-base font-extrabold tracking-[0.12em]">ECOS</span>
        </Link>
      </div>

      <nav className="relative flex-1 px-2">
        <div
          className="pointer-events-none absolute left-0 top-0 h-full w-[1px] bg-gradient-to-b from-transparent via-border/40 to-transparent"
          aria-hidden
        />

        <div className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            const label =
              item.labelKey === "profile" ? profileLabel : t(item.labelKey);

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                  active
                    ? "bg-brand/10 text-brand"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
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
                      staleTime: hasRecentCompletion ? 0 : HOME_TODAY_STALE_MS,
                    });
                    void queryClient.prefetchQuery({
                      queryKey: queryKeys.home.previousDays(monthKey, uid),
                      queryFn: () => fetchHomePreviousDaysData(monthKey),
                      staleTime: hasRecentCompletion
                        ? 0
                        : HOME_PREVIOUS_DAYS_STALE_MS,
                      gcTime: HOME_PREVIOUS_DAYS_GC_MS,
                    });
                    if (uid) {
                      void queryClient.prefetchQuery({
                        queryKey: queryKeys.home.userStats(uid),
                        queryFn: fetchHomeUserStatsData,
                        staleTime: hasRecentCompletion ? 0 : HOME_TODAY_STALE_MS,
                      });
                    }
                  }

                  if (item.href === "/ranking") {
                    if (hasRecentCompletion) {
                      void queryClient.invalidateQueries({
                        queryKey: queryKeys.ranking.all,
                      });
                    }
                    for (const period of ["weekly", "monthly", "global"] as const) {
                      void queryClient.prefetchQuery({
                        queryKey: queryKeys.ranking.period(period),
                        queryFn: () => fetchLeaderboardPeriodData(period),
                        staleTime: hasRecentCompletion ? 0 : RANKING_STALE_MS,
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
                      staleTime: hasRecentCompletion ? 0 : PROFILE_STALE_MS,
                    });
                  }
                }}
              >
                <span
                  className={cn(
                    "absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity",
                    active ? "bg-brand opacity-100" : "opacity-0"
                  )}
                  aria-hidden
                />

                <motion.span
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    "material-symbols-outlined text-[22px] leading-none transition-colors",
                    active ? "text-brand" : "text-muted-foreground group-hover:text-foreground"
                  )}
                  style={{
                    fontVariationSettings: "'FILL' 1, 'wght' 500, 'opsz' 24",
                  }}
                >
                  {item.icon}
                </motion.span>

                <span className="min-w-0 flex-1 truncate">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-border/40 p-3">
        <Link
          href="/profile"
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
            isActive("/profile")
              ? "bg-brand/10"
              : "hover:bg-muted/60"
          )}
        >
          <div className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-border/50 bg-background/60">
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/18 via-transparent to-transparent"
              aria-hidden
            />
            <span className="relative text-sm font-extrabold text-foreground/80">
              {profileInitial}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{profileLabel}</div>
            <div className="truncate text-xs text-muted-foreground">
              {user ? "Cuenta" : "Invitado"}
            </div>
          </div>
          <span aria-hidden className="material-symbols-outlined text-[18px] text-muted-foreground">
            chevron_right
          </span>
        </Link>
      </div>
    </aside>
  );
}
