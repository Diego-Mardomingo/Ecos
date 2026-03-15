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
}

const NAV_ITEMS: NavItem[] = [
  { href: "/ranking", labelKey: "ranking", icon: "leaderboard" },
  { href: "/", labelKey: "play", icon: "play_circle" },
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
    <nav className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 border-t-2 border-brand/40 bg-card">
      {/* Blob verde sutil centrado en Inicio */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/8 blur-[50px]"
        aria-hidden
      />
      <div className="relative flex justify-around px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
              onClick={(e) => {
                if (active) {
                  e.preventDefault();
                  document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                <motion.span
                  whileTap={{ scale: 0.85 }}
                  className={cn(
                    "material-symbols-outlined transition-colors",
                    active ? "text-brand" : "text-muted-foreground"
                  )}
                  style={{
                    fontVariationSettings: "'FILL' 1, 'wght' 500, 'opsz' 28",
                    fontSize: 28,
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
