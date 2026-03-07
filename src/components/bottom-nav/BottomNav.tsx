"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  labelKey: string;
  icon: string;
  isFab?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/ranking", labelKey: "ranking", icon: "leaderboard" },
  { href: "/", labelKey: "home", icon: "play_circle", isFab: true },
  { href: "/profile", labelKey: "profile", icon: "person" },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  // Normalizar pathname quitando el prefijo de locale (/en/... → /...)
  const normalizedPath = pathname.replace(/^\/(es|en)/, "") || "/";

  const isActive = (href: string) => {
    if (href === "/") return normalizedPath === "/";
    return normalizedPath.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 border-t border-brand/40 bg-card">
      {/* Blob verde sutil centrado en Inicio */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/8 blur-[50px]"
        aria-hidden
      />
      <div className="relative flex justify-around px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);

          if (item.isFab) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                  <motion.div
                    whileTap={{ scale: 0.92 }}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg shadow-md transition-all ring-1 ring-brand/30",
                      active
                        ? "bg-brand shadow-brand/30"
                        : "bg-brand/20 shadow-brand/10"
                    )}
                  >
                    <span
                      className={cn(
                        "material-symbols-outlined text-2xl leading-none",
                        active ? "text-[#111827]" : "text-brand"
                      )}
                      style={{
                        fontVariationSettings: "'FILL' 1, 'wght' 600",
                      }}
                    >
                      {item.icon}
                    </span>
                  </motion.div>
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium transition-colors",
                    active ? "text-brand" : "text-muted-foreground"
                  )}
                >
                  {t(item.labelKey)}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                <motion.span
                  whileTap={{ scale: 0.85 }}
                  className={cn(
                    "material-symbols-outlined text-2xl transition-colors",
                    active ? "text-brand" : "text-muted-foreground"
                  )}
                  style={{
                    fontVariationSettings: active
                      ? "'FILL' 1, 'wght' 500"
                      : "'FILL' 0, 'wght' 400",
                  }}
                >
                  {item.icon}
                </motion.span>
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium transition-colors",
                  active ? "text-brand" : "text-muted-foreground"
                )}
              >
                {t(item.labelKey)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
