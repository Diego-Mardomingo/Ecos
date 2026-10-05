"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";

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

/** Aviso flotante de «sin conexión»: baja desde arriba al perder la red y se va al recuperarla. */
export function OfflineBanner() {
  const t = useTranslations("common");
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerSnapshot);

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          role="status"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[max(0.5rem,env(safe-area-inset-top))]"
        >
          <span className="flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-xs font-semibold text-white shadow-lg sm:text-sm">
            <span aria-hidden className="material-symbols-outlined text-base">wifi_off</span>
            {t("offline")}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
