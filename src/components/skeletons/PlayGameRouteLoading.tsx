"use client";

import { useSyncExternalStore } from "react";
import {
  PLAY_SKELETON_VARIANT_KEY,
  type PlaySkeletonVariant,
} from "@/lib/navigation/playSkeletonStorage";
import {
  PlayGameCompletedDetailSkeleton,
  PlayGameInProgressDetailSkeleton,
} from "@/components/skeletons/play-game-detail-skeletons";

function readVariantFromSession(): PlaySkeletonVariant {
  if (typeof window === "undefined") return "in_progress";
  try {
    const v = sessionStorage.getItem(PLAY_SKELETON_VARIANT_KEY);
    return v === "completed" ? "completed" : "in_progress";
  } catch {
    return "in_progress";
  }
}

/** sessionStorage no emite eventos propios: la variante se lee una vez, no se suscribe a nada. */
const subscribeToNothing = () => () => {};
const getServerVariant = (): PlaySkeletonVariant => "in_progress";

/** Skeleton de ruta /play/[gameId] mientras llega el RSC; variante según navegación desde la home. */
export function PlayGameRouteLoading() {
  // useSyncExternalStore en lugar de leer en un efecto: el snapshot de servidor
  // evita el desajuste de hidratación sin pasar por un render extra.
  const variant = useSyncExternalStore(
    subscribeToNothing,
    readVariantFromSession,
    getServerVariant
  );

  return variant === "completed" ? (
    <PlayGameCompletedDetailSkeleton />
  ) : (
    <PlayGameInProgressDetailSkeleton />
  );
}
