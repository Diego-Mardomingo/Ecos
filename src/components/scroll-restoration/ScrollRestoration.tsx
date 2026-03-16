"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function ScrollRestoration() {
  const pathname = usePathname();

  useEffect(() => {
    const key = `scroll:${pathname}`;
    const saved = sessionStorage.getItem(key);
    const targetTop = saved ? parseInt(saved, 10) : 0;

    let rafId: number | null = null;
    if (targetTop > 0) {
      const restore = () => {
        window.scrollTo({ top: targetTop, left: 0, behavior: "auto" });
      };
      const maxWait = 2500;
      const start = Date.now();

      const tryRestore = () => {
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

      rafId = requestAnimationFrame(tryRestore);
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
