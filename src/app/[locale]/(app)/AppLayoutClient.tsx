"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav/BottomNav";
import {
  useAppPullToRefreshEnabled,
  usePullToRefreshScrollRoot,
  useScrollRootCallbackRef,
} from "@/components/pull-to-refresh/usePullToRefreshScrollRoot";
import { OfflineBanner } from "@/components/offline/OfflineBanner";

function isPlayRoute(pathname: string): boolean {
  const normalized = pathname.replace(/^\/(es|en)/, "") || "/";
  return normalized === "/play" || normalized.startsWith("/play/");
}

export function AppLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNav = !isPlayRoute(pathname);
  const pullEnabled = useAppPullToRefreshEnabled();
  const { scrollRoot, setScrollRoot } = useScrollRootCallbackRef();
  usePullToRefreshScrollRoot(scrollRoot, { enabled: pullEnabled });

  return (
    <>
      <OfflineBanner />
      <main
        ref={setScrollRoot}
        className={`flex flex-1 flex-col overflow-y-auto min-h-0 ${showNav ? "pt-6 pt-safe pb-24" : "pt-0 pb-6"}`}
        data-scroll-root
        id="app-scroll-root"
      >
        {children}
      </main>
      {showNav && <BottomNav />}
    </>
  );
}
