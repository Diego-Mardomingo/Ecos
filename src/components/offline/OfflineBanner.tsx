"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function getOnlineSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

export function OfflineBanner() {
  const t = useTranslations("common");
  const online = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getServerSnapshot
  );

  if (online) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 w-full border-b border-destructive/40 bg-destructive px-3 py-2 text-center text-xs text-destructive-foreground sm:text-sm"
    >
      {t("offline")}
    </div>
  );
}
