"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function ScrollRestoration() {
  const pathname = usePathname();

  useEffect(() => {
    const key = `scroll:${pathname}`;
    const saved = sessionStorage.getItem(key);
    const top = saved ? parseInt(saved, 10) : 0;

    const restore = () => {
      window.scrollTo({ top, left: 0, behavior: "auto" });
    };
    // Next.js resetea el scroll al navegar; el contenido puede no estar montado aún.
    // Aplicamos la restauración varias veces para cuando el layout esté listo.
    const delays = [150, 400, 800, 1200];
    const timeouts = delays.map((d) => setTimeout(restore, d));

    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sessionStorage.setItem(key, String(window.scrollY));
      }, 150);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      timeouts.forEach(clearTimeout);
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);

  return null;
}
