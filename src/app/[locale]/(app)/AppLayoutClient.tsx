"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav/BottomNav";
import { SidebarNav } from "@/components/sidebar-nav/SidebarNav";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { PlayNavigationPendingOverlay } from "@/components/navigation/PlayNavigationPendingOverlay";
import { NotificationsModal } from "@/components/notifications/NotificationsModal";
import { cn } from "@/lib/utils";

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
      <div className="flex min-h-0 flex-1 flex-col min-[670px]:flex-row">
        {showNav && <SidebarNav />}
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto",
            showNav
              ? "pt-6 pt-safe pb-24 min-[670px]:pt-8 min-[670px]:pb-6"
              : "pt-0 pb-6"
          )}
        >
          <div className="mx-auto w-full max-w-md">{children}</div>
        </main>
      </div>
      <PlayNavigationPendingOverlay />
      {showNav && <BottomNav />}
      <NotificationsModal />
    </>
  );
}
