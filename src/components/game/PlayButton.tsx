"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Botón redondo de play/stop de la partida y del resultado.
 *
 * - Listo y en espera: respira (`.ecos-breathe`), para invitar a pulsarlo.
 * - Sonando: dos ondas expansivas desfasadas (`.ecos-ping`).
 * - El icono cambia girando y escalando entre play, stop y carga.
 *
 * Los iconos son SVG y van con `key` por estado. Con el glifo de Material Symbols, iOS Safari
 * dejaba rasterizado el anterior debajo del nuevo cuando solo cambiaba el texto del nodo (el
 * botón vive en una capa de composición); sustituir el nodo entero lo evita.
 */
export function PlayButton({
  playing,
  loaded,
  onClick,
  size = 80,
  labels,
  className,
}: {
  playing: boolean;
  loaded: boolean;
  onClick: () => void;
  size?: number;
  labels: { play: string; stop: string; loading: string };
  className?: string;
}) {
  const state = !loaded ? "loading" : playing ? "stop" : "play";

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      {playing && (
        <>
          <span aria-hidden className="ecos-ping absolute inset-0 rounded-full bg-brand/35" />
          <span aria-hidden className="ecos-ping absolute inset-0 rounded-full bg-brand/25 [animation-delay:0.8s]" />
        </>
      )}
      <motion.button
        type="button"
        onClick={onClick}
        disabled={!loaded}
        whileHover={loaded ? { scale: 1.06 } : undefined}
        whileTap={loaded ? { scale: 0.9 } : undefined}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
        aria-label={state === "loading" ? labels.loading : state === "stop" ? labels.stop : labels.play}
        className={cn(
          "relative flex size-full items-center justify-center rounded-full transition-colors duration-300",
          loaded
            ? "bg-brand text-primary-foreground"
            : "cursor-not-allowed bg-muted text-muted-foreground",
          state === "play" && "ecos-breathe"
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state}
            initial={{ scale: 0.3, opacity: 0, rotate: -90 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.3, opacity: 0, rotate: 90 }}
            transition={{ type: "spring", stiffness: 520, damping: 30 }}
            className="flex items-center justify-center"
            aria-hidden
          >
            {state === "play" ? (
              <svg viewBox="0 0 24 24" className="translate-x-[6%]" style={{ width: size * 0.4, height: size * 0.4 }}>
                <path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.3-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8Z" fill="currentColor" />
              </svg>
            ) : state === "stop" ? (
              <svg viewBox="0 0 24 24" style={{ width: size * 0.34, height: size * 0.34 }}>
                <rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="animate-spin" style={{ width: size * 0.36, height: size * 0.36 }}>
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
