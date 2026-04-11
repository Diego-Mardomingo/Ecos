"use client";

import { useLayoutEffect, useState } from "react";
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

/** Skeleton de ruta /play/[gameId] mientras llega el RSC; variante según navegación desde la home. */
export function PlayGameRouteLoading() {
  const [variant, setVariant] = useState<PlaySkeletonVariant>("in_progress");

  useLayoutEffect(() => {
    setVariant(readVariantFromSession());
  }, []);

  return variant === "completed" ? (
    <PlayGameCompletedDetailSkeleton />
  ) : (
    <PlayGameInProgressDetailSkeleton />
  );
}
