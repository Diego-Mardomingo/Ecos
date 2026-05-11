"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface MarqueeTextProps {
  /** Texto a mostrar. Si cabe entero, no se anima; si se desborda, hace scroll en bucle. */
  text: string;
  /** Clases CSS adicionales aplicadas al contenedor (font-size, color, weight, etc.). */
  className?: string;
  /**
   * Velocidad de la fase de lectura (desplazamiento de izquierda a derecha, lenta),
   * en píxeles por segundo. A mayor número, más rápido lee.
   * @default 35
   */
  speedPxPerSec?: number;
  /**
   * Velocidad de la fase de retorno al inicio (rápida), en píxeles por segundo.
   * Para conseguir el efecto Spotify/Apple Music, debe ser claramente mayor que `speedPxPerSec`.
   * @default 140
   */
  returnSpeedPxPerSec?: number;
  /**
   * Tiempo de pausa (en segundos) al inicio y al final del ciclo, antes de invertir o reiniciar.
   * @default 1.4
   */
  pauseSec?: number;
  /** Margen extra (px) sobre el overflow detectado antes de animar; evita micro-animaciones por subpíxeles. */
  overflowThresholdPx?: number;
}

/**
 * Texto con marquee horizontal estilo Spotify/Apple Music:
 * - Si el contenido cabe, se renderiza con `truncate` normal.
 * - Si se desborda, anima con un ciclo: pausa → scroll a la izquierda → pausa → scroll de vuelta → repetir.
 * - Respeta `prefers-reduced-motion`: en ese caso solo trunca con elipsis sin animación.
 *
 * El componente mide el overflow real con `ResizeObserver`, por lo que reacciona al
 * cambio de ancho del contenedor (rotar pantalla, abrir sidebar, etc.).
 */
export function MarqueeText({
  text,
  className,
  speedPxPerSec = 35,
  returnSpeedPxPerSec = 140,
  pauseSec = 1.4,
  overflowThresholdPx = 2,
}: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const shouldReduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    const measure = () => {
      const containerWidth = container.clientWidth;
      const textWidth = textEl.scrollWidth;
      const diff = textWidth - containerWidth;
      setOverflowPx(diff > overflowThresholdPx ? diff : 0);
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text, overflowThresholdPx]);

  const animate = overflowPx > 0 && !shouldReduceMotion;

  /**
   * Animación: pausa(p) → slide lento (s) → pausa(p) → return rápido (r) → loop.
   * Mínimo 2.5s para el slide y 0.45s para el return: evita parpadeos en overflows pequeños
   * y mantiene la sensación "rebobinado rápido" en todos los casos.
   */
  const slideSec = Math.max(2.5, overflowPx / speedPxPerSec);
  const returnSec = Math.max(0.45, overflowPx / returnSpeedPxPerSec);
  const totalSec = pauseSec * 2 + slideSec + returnSec;
  const tPauseEnd = pauseSec / totalSec;
  const tSlideEnd = (pauseSec + slideSec) / totalSec;
  const tReturnStart = (pauseSec * 2 + slideSec) / totalSec;

  return (
    <div
      ref={containerRef}
      className={cn("relative min-w-0 overflow-hidden", className)}
      aria-label={text}
    >
      <motion.span
        ref={textRef}
        className={cn(
          "inline-block whitespace-nowrap",
          /* Cuando no animamos pero hay overflow (reduced motion), aseguramos elipsis */
          !animate && overflowPx > 0 && "max-w-full overflow-hidden text-ellipsis align-bottom"
        )}
        animate={animate ? { x: [0, 0, -overflowPx, -overflowPx, 0] } : { x: 0 }}
        transition={
          animate
            ? {
                duration: totalSec,
                times: [0, tPauseEnd, tSlideEnd, tReturnStart, 1],
                /**
                 * Ease por segmento (5 keyframes → 4 segmentos):
                 *   1. pausa inicial   → linear (sin movimiento real)
                 *   2. scroll de lectura → linear (velocidad uniforme, fácil de seguir)
                 *   3. pausa final     → linear (sin movimiento real)
                 *   4. retorno rápido  → easeOut (acelera y desacelera, sensación de "rebobinado")
                 */
                ease: ["linear", "linear", "linear", [0.22, 1, 0.36, 1]],
                repeat: Infinity,
              }
            : { duration: 0 }
        }
      >
        {text}
      </motion.span>
    </div>
  );
}
