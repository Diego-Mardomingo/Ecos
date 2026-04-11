"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * Intercepta clics en enlaces internos dentro de `main` y envuelve la navegación en
 * `document.startViewTransition` cuando el navegador lo soporta (Chrome, Safari recientes).
 */
export function ViewTransitionNavigationBridge() {
  const router = useRouter();

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    const navigateToAnchor = (anchor: HTMLAnchorElement) => {
      let path: string;
      try {
        const url = new URL(anchor.href, window.location.origin);
        path = url.pathname + url.search + url.hash;
      } catch {
        return;
      }

      const start = document.startViewTransition?.bind(document);
      if (start) {
        start(() => {
          router.push(path);
        });
      } else {
        router.push(path);
      }
    };

    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!anchor || !(anchor instanceof HTMLAnchorElement)) return;

      const hrefAttr = anchor.getAttribute("href");
      if (!hrefAttr || hrefAttr.startsWith("#")) return;
      if (hrefAttr.startsWith("mailto:") || hrefAttr.startsWith("tel:")) return;

      try {
        const url = new URL(anchor.href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        const here =
          window.location.pathname + window.location.search + window.location.hash;
        const there = url.pathname + url.search + url.hash;
        if (here === there) return;
      } catch {
        return;
      }

      const nativeDownload = anchor.hasAttribute("download");
      if (nativeDownload) return;
      if (anchor.target === "_blank") return;

      e.preventDefault();
      navigateToAnchor(anchor);
    };

    main.addEventListener("click", onClickCapture, true);
    return () => main.removeEventListener("click", onClickCapture, true);
  }, [router]);

  return null;
}
