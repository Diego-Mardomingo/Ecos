"use client";

import { useCallback } from "react";
import { useRouter } from "@/i18n/navigation";

export const PLAY_FROM_HOME_STORAGE_KEY = "ecos_play_from_home";

/**
 * Si se llegó a /play desde la home, cancela el enlace y vuelve atrás en el historial. Va fuera
 * del hook porque el React Compiler no admite condicionales dentro de un `try` y dejaría el hook
 * sin compilar.
 */
function backIfFromHome(e: React.MouseEvent<HTMLAnchorElement>, router: { back: () => void }) {
  try {
    const fromHome =
      typeof window !== "undefined" &&
      sessionStorage.getItem(PLAY_FROM_HOME_STORAGE_KEY) === "1";
    if (fromHome && window.history.length > 1) {
      sessionStorage.removeItem(PLAY_FROM_HOME_STORAGE_KEY);
      e.preventDefault();
      router.back();
      return;
    }
    if (fromHome) {
      sessionStorage.removeItem(PLAY_FROM_HOME_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Vuelve al inicio con el mismo historial que el gesto “atrás” cuando la entrada a /play vino desde la home.
 */
export function useNavigateBackToHome() {
  const router = useRouter();

  return useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => backIfFromHome(e, router),
    [router]
  );
}
