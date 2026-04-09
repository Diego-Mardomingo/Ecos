"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import {
  ECOS_PTR_CLASS_PREFIX,
  ECOS_PTR_ICONS,
  getEcosPullToRefreshMarkup,
  getEcosPullToRefreshStyles,
} from "./ecosPullToRefreshUi";

const TOP_CLASS = `${ECOS_PTR_CLASS_PREFIX}top`;
const PTR_CONTAINER_CLASS = `${ECOS_PTR_CLASS_PREFIX}ptr`;

function removePtrSibling(main: HTMLElement) {
  const prev = main.previousElementSibling;
  if (prev?.classList.contains(PTR_CONTAINER_CLASS)) {
    prev.remove();
  }
}

/** Móvil táctil con viewport estrecho: evita PTR en escritorio aunque tenga pantalla táctil ancha. */
const MOBILE_PULL_MEDIA = "(pointer: coarse) and (max-width: 1023px)";

function useMobilePullEnabled(): boolean {
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_PULL_MEDIA);
    const apply = () => setOk(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return ok;
}

/**
 * Engancha pulltorefreshjs al nodo scrollable (p. ej. `<main data-scroll-root>`).
 * Solo tiene efecto cuando `enabled` es true (normalmente móvil).
 */
export function usePullToRefreshScrollRoot(
  scrollRoot: HTMLElement | null,
  { enabled }: { enabled: boolean }
) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("pullToRefresh");

  useEffect(() => {
    if (!enabled || !scrollRoot) return;

    let disposed = false;
    let ptrHandler: { destroy: () => void } | null = null;
    let removeScroll: (() => void) | null = null;

    void import("pulltorefreshjs").then(({ default: PullToRefresh }) => {
      if (disposed) return;
      const el = scrollRoot;
      if (!el) return;

      removePtrSibling(el);

      const syncTopClass = () => {
        el.classList.toggle(TOP_CLASS, el.scrollTop <= 0);
      };

      el.addEventListener("scroll", syncTopClass, { passive: true });
      syncTopClass();
      removeScroll = () => el.removeEventListener("scroll", syncTopClass);

      ptrHandler = PullToRefresh.init({
        mainElement: el,
        triggerElement: el,
        classPrefix: ECOS_PTR_CLASS_PREFIX,
        shouldPullToRefresh: () => el.scrollTop <= 0,
        getMarkup: getEcosPullToRefreshMarkup,
        getStyles: getEcosPullToRefreshStyles,
        iconArrow: ECOS_PTR_ICONS.iconArrow,
        iconRefreshing: ECOS_PTR_ICONS.iconRefreshing,
        instructionsPullToRefresh: t("pull"),
        instructionsReleaseToRefresh: t("release"),
        instructionsRefreshing: t("refreshing"),
        distThreshold: 56,
        distMax: 96,
        distReload: 52,
        refreshTimeout: 400,
        onRefresh: async () => {
          router.refresh();
          await queryClient.invalidateQueries();
        },
      });
    });

    return () => {
      disposed = true;
      removeScroll?.();
      removeScroll = null;
      ptrHandler?.destroy();
      ptrHandler = null;
      removePtrSibling(scrollRoot);
      scrollRoot.classList.remove(TOP_CLASS);
    };
  }, [enabled, queryClient, router, scrollRoot, t]);
}

export function useAppPullToRefreshEnabled(): boolean {
  return useMobilePullEnabled();
}

/** Ref callback estable para guardar el `<main>` scrollable en estado y pasarlo al hook PTR. */
export function useScrollRootCallbackRef() {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const setScrollRoot = useCallback((el: HTMLElement | null) => {
    setNode(el);
  }, []);
  return { scrollRoot: node, setScrollRoot };
}
