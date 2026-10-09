"use client";

import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav/BottomNav";
import { SidebarNav } from "@/components/sidebar-nav/SidebarNav";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { PlayNavigationPendingOverlay } from "@/components/navigation/PlayNavigationPendingOverlay";
import { cn } from "@/lib/utils";
import { stripLocalePrefix } from "@/i18n/locale-path";
import { isAudioDebugEnabled } from "@/lib/audio/audioDebug";

/** Diagnóstico de audio (`?audioDebug=1`): fuera del bundle salvo que se active. */
const AudioDebugPanel = dynamic(
  () => import("@/components/audio-player/AudioDebugPanel").then((mod) => mod.AudioDebugPanel),
  { ssr: false }
);

/** Se decide una vez por carga de página, así que no hay nada a lo que suscribirse. */
const subscribeToNothing = () => () => {};
const audioDebugOffOnServer = () => false;

function isPlayRoute(pathname: string): boolean {
  const normalized = stripLocalePrefix(pathname);
  return normalized === "/play" || normalized.startsWith("/play/");
}

export function AppLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNav = !isPlayRoute(pathname);
  const audioDebug = useSyncExternalStore(subscribeToNothing, isAudioDebugEnabled, audioDebugOffOnServer);

  return (
    <>
      <OfflineBanner />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col min-[670px]:flex-row">
        {showNav && <SidebarNav />}
        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto",
            showNav
              ? "pt-safe pb-24 min-[670px]:pt-8 min-[670px]:pb-6"
              : "pt-0 pb-6"
          )}
        >
          <div className="mx-auto w-full min-w-0 max-w-md">{children}</div>
        </main>
      </div>
      <PlayNavigationPendingOverlay />
      {showNav && <BottomNav />}
      {audioDebug && <AudioDebugPanel />}
    </>
  );
}
