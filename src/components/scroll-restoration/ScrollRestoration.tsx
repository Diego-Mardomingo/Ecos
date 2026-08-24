"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { stripLocalePrefix } from "@/i18n/locale-path";

const SCROLL_SKIP_THRESHOLD_PX = 16;

function normalizedAppPath(pathname: string): string {
  return stripLocalePrefix(pathname);
}

export function ScrollRestoration() {
  const pathname = usePathname();

  useEffect(() => {
    const key = `scroll:${pathname}`;
    const saved = sessionStorage.getItem(key);
    const targetTop = saved ? parseInt(saved, 10) : 0;

    const isHomeRoute = normalizedAppPath(pathname) === "/";

    let rafId: number | null = null;
    if (targetTop > 0) {
      const restore = () => {
        window.scrollTo({ top: targetTop, left: 0, behavior: "auto" });
      };
      const maxWait = 2500;
      const start = Date.now();

      const tryRestore = () => {
        if (Math.abs(window.scrollY - targetTop) < SCROLL_SKIP_THRESHOLD_PX) {
          return;
        }
        const doc = document.documentElement;
        const canScroll = doc.scrollHeight >= targetTop + window.innerHeight * 0.5;
        if (canScroll) {
          restore();
          return;
        }
        if (Date.now() - start < maxWait) {
          rafId = requestAnimationFrame(tryRestore);
        }
      };

      const kickoff = () => {
        rafId = requestAnimationFrame(tryRestore);
      };

      if (isHomeRoute) {
        rafId = requestAnimationFrame(() => {
          rafId = requestAnimationFrame(kickoff);
        });
      } else {
        rafId = requestAnimationFrame(kickoff);
      }
    }

    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sessionStorage.setItem(key, String(window.scrollY));
      }, 150);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);

  return null;
}
