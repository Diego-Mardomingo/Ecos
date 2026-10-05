"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Número que cuenta hasta su valor: desde `from` al montar, y desde el valor anterior cuando
 * cambia.
 *
 * El recuento escribe directamente en el `textContent` del nodo y no pasa por estado: son ~60
 * actualizaciones por segundo durante casi un segundo, y con estado cada una sería un render.
 * React solo pinta el texto inicial; a partir de ahí el nodo es del efecto.
 *
 * Con `prefers-reduced-motion` salta al valor final sin animar. `MotionConfig` no cubre el
 * `animate()` imperativo, así que se comprueba aquí.
 */
export function AnimatedNumber({
  value,
  format,
  from = 0,
  duration = 0.9,
  delay = 0,
  className,
}: {
  value: number;
  /** Debe ser estable (p. ej. el `formatNumber` de `useAppFormatters`). */
  format: (value: number) => string;
  from?: number;
  duration?: number;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  // Texto del primer render, fijado una sola vez: si dependiera de `value`, React lo reescribiría
  // en cada cambio y se vería un fotograma con el valor final antes de empezar a contar.
  const [initialText] = useState(() => format(reduceMotion ? value : from));
  /**
   * Valor que se ve ahora mismo. Se parte de aquí y no del último `value`: si una animación se
   * corta a medias (o React monta el efecto dos veces en desarrollo), la siguiente sigue desde
   * donde estaba el número, no desde el destino de la anterior.
   */
  const shownRef = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = shownRef.current ?? (reduceMotion ? value : from);
    if (reduceMotion || start === value) {
      shownRef.current = value;
      el.textContent = format(value);
      return;
    }
    const controls = animate(start, value, {
      duration,
      delay,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        const rounded = Math.round(v);
        shownRef.current = rounded;
        el.textContent = format(rounded);
      },
    });
    return () => controls.stop();
  }, [value, from, duration, delay, format, reduceMotion]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {initialText}
    </span>
  );
}
