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
  { href: "/", labelKey: "home", icon: "home" },
  { href: "/ranking", labelKey: "ranking", icon: "leaderboard" },
  { href: "/play", labelKey: "play", icon: "play_circle", isFab: true },
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
    <nav className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2">
      <div
        className="relative flex items-end justify-around px-2 pb-safe"
        style={{
          background:
            "linear-gradient(to top, var(--card) 85%, transparent)",
          borderTop: "1px solid var(--border)",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);

          if (item.isFab) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative -mt-5 flex flex-col items-center gap-1"
              >
                <motion.div
                  whileTap={{ scale: 0.92 }}
                  className={cn(
                    "flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all",
                    active
                      ? "bg-brand shadow-brand/40"
                      : "bg-brand shadow-brand/20"
                  )}
                >
                  <span
                    className="material-symbols-outlined text-2xl"
                    style={{
                      color: "#0a2015",
                      fontVariationSettings: "'FILL' 1, 'wght' 600",
                    }}
                  >
                    {item.icon}
                  </span>
                </motion.div>
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
              className="flex flex-col items-center gap-1 py-3"
            >
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
