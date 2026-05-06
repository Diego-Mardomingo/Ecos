"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav/BottomNav";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { PlayNavigationPendingOverlay } from "@/components/navigation/PlayNavigationPendingOverlay";
import { NotificationsModal } from "@/components/notifications/NotificationsModal";

function isPlayRoute(pathname: string): boolean {
  const normalized = pathname.replace(/^\/(es|en)/, "") || "/";
  return normalized === "/play" || normalized.startsWith("/play/");
}

export function AppLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNav = !isPlayRoute(pathname);

  return (
    <>
      <OfflineBanner />
      <main
        className={`flex flex-1 flex-col overflow-y-auto min-h-0 ${showNav ? "pt-6 pt-safe pb-24" : "pt-0 pb-6"}`}
      >
        {children}
      </main>
      <PlayNavigationPendingOverlay />
      {showNav && <BottomNav />}
      <NotificationsModal />
    </>
  );
}
