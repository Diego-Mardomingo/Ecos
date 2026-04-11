"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Dispara prefetch de ruta + queries de partida cuando el enlace entra en el viewport,
 * para clicks sin pasar por hover (móvil, scroll rápido).
 */
export function PrefetchPlayOnVisible({
  gameId,
  onPrefetch,
  children,
}: {
  gameId: string;
  onPrefetch: (gameId: string) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onPrefetch(gameId);
          io.disconnect();
        }
      },
      { root: null, rootMargin: "160px 0px", threshold: 0 }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [gameId, onPrefetch]);

  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}
