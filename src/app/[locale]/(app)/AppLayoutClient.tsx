"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav/BottomNav";

function isPlayRoute(pathname: string): boolean {
  const normalized = pathname.replace(/^\/(es|en)/, "") || "/";
  return normalized === "/play" || normalized.startsWith("/play/");
}

export function AppLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNav = !isPlayRoute(pathname);

  return (
    <>
      <main
        className={`flex-1 overflow-y-auto min-h-0 ${showNav ? "pt-6 pt-safe pb-24" : "pt-0 pb-6"}`}
        data-scroll-root
      >
        {children}
      </main>
      {showNav && <BottomNav />}
    </>
  );
}
