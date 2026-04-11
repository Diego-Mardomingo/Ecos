"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  PLAY_SKELETON_VARIANT_KEY,
  type PlaySkeletonVariant,
} from "@/lib/navigation/playSkeletonStorage";
import {
  PLAY_NAVIGATION_END_EVENT,
  PLAY_NAVIGATION_START_EVENT,
} from "@/lib/navigation/playNavigationEvents";
import {
  PlayGameCompletedDetailSkeleton,
  PlayGameInProgressDetailSkeleton,
} from "@/components/skeletons/play-game-detail-skeletons";

function readVariant(): PlaySkeletonVariant {
  if (typeof window === "undefined") return "in_progress";
  try {
    const v = sessionStorage.getItem(PLAY_SKELETON_VARIANT_KEY);
    return v === "completed" ? "completed" : "in_progress";
  } catch {
    return "in_progress";
  }
}

/**
 * Cubre la pantalla con el skeleton de detalle mientras la navegación home → /play/[id]
 * termina de pintar. `loading.tsx` no basta si la ruta estaba prefetcheada (RSC en caché).
 */
export function PlayNavigationPendingOverlay() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [variant, setVariant] = useState<PlaySkeletonVariant>("in_progress");

  useEffect(() => {
    const onStart = () => {
      setVariant(readVariant());
      setVisible(true);
    };
    const onEnd = () => setVisible(false);
    window.addEventListener(PLAY_NAVIGATION_START_EVENT, onStart);
    window.addEventListener(PLAY_NAVIGATION_END_EVENT, onEnd);
    return () => {
      window.removeEventListener(PLAY_NAVIGATION_START_EVENT, onStart);
      window.removeEventListener(PLAY_NAVIGATION_END_EVENT, onEnd);
    };
  }, []);

  useEffect(() => {
    const normalized = pathname.replace(/^\/(es|en)/, "") || "/";
    if (!normalized.startsWith("/play/")) {
      setVisible(false);
    }
  }, [pathname]);

  /** Si nunca monta PlayGameWrapper (p. ej. notFound), evitar overlay colgado. */
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => setVisible(false), 12_000);
    return () => window.clearTimeout(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-background"
      aria-busy
      aria-live="polite"
    >
      {variant === "completed" ? (
        <PlayGameCompletedDetailSkeleton />
      ) : (
        <PlayGameInProgressDetailSkeleton />
      )}
    </div>
  );
}
