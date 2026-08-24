"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Las dos waveforms decorativas de la home (la compacta de la cabecera y la grande de la
 * tarjeta del día) y el `useMediaQuery` que solo usa la segunda. Extraído de `HomeClient`
 * sin cambios de lógica.
 */
function useMediaQuery(query: string) {
  // matchMedia es exactamente el tipo de fuente externa para la que existe
  // useSyncExternalStore: evita el setState síncrono dentro del efecto.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Waveform compacta junto al nombre: misma lógica que WaveformBars (ola centrada verticalmente). */
function HeaderBrandWaveform() {
  const barCount = 12;
  const barWidth = 2;
  const gap = 2;
  const heightBase = 4;
  const heightRange = 14;

  const bars = useMemo(
    () =>
      Array.from({ length: barCount }, (_, i) => ({
        key: i,
        heightA: heightBase + ((i * 7) % Math.round(heightRange)),
        heightB: heightBase + ((i * 11 + 13) % Math.round(heightRange)),
        duration: 0.6 + (i % 10) * 0.08,
        delay: i * 0.04,
      })),
    []
  );

  return (
    <div
      className="ml-1.5 mr-1 flex min-h-0 min-w-0 max-w-[3.25rem] shrink-0 self-center opacity-75 sm:ml-2 sm:mr-2 sm:max-w-[3.75rem]"
      aria-hidden
    >
      <div className="flex h-9 w-full items-center justify-center">
        <div
          className="flex items-center justify-center"
          style={{ gap: `${gap}px` }}
        >
          {bars.map(({ key, heightA, heightB, duration, delay }) => (
            <motion.div
              key={key}
              className="shrink-0 rounded-full bg-brand"
              style={{ width: `${barWidth}px`, minWidth: `${barWidth}px` }}
              animate={{ height: [`${heightA}px`, `${heightB}px`] }}
              transition={{
                duration,
                repeat: Infinity,
                repeatType: "reverse",
                ease: "easeInOut",
                delay,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WaveformBars({ className }: { className?: string }) {
  const isSm = useMediaQuery("(min-width: 640px)");
  const isMd = useMediaQuery("(min-width: 768px)");

  const { barCount, barWidth, heightBase, heightRange, gap } = useMemo(() => {
    if (isMd) return { barCount: 52, barWidth: 4, heightBase: 12, heightRange: 32, gap: 3 };
    if (isSm) return { barCount: 44, barWidth: 3, heightBase: 10, heightRange: 28, gap: 2.5 };
    return { barCount: 36, barWidth: 2.5, heightBase: 8, heightRange: 24, gap: 2 };
  }, [isSm, isMd]);

  const bars = useMemo(
    () =>
      Array.from({ length: barCount }, (_, i) => ({
        key: i,
        heightA: heightBase + ((i * 7) % Math.round(heightRange)),
        heightB: heightBase + ((i * 11 + 13) % Math.round(heightRange)),
        duration: 0.6 + (i % 10) * 0.08,
        delay: i * 0.02,
      })),
    [barCount, heightBase, heightRange]
  );

  return (
    <div
      className={cn(
        "absolute inset-x-0 top-[52%] flex -translate-y-1/2 items-center justify-center px-4 opacity-60",
        className
      )}
      style={{ gap: `${gap}px` }}
    >
      <div
        className="flex items-center justify-center"
        style={{ gap: `${gap}px` }}
      >
      {bars.map(({ key, heightA, heightB, duration, delay }) => (
        <motion.div
          key={key}
          className="rounded-full bg-brand shrink-0"
          style={{ width: `${barWidth}px`, minWidth: `${barWidth}px` }}
          animate={{ height: [`${heightA}px`, `${heightB}px`] }}
          transition={{
            duration,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "easeInOut",
            delay,
          }}
        />
      ))}
      </div>
    </div>
  );
}

export { HeaderBrandWaveform, WaveformBars };
