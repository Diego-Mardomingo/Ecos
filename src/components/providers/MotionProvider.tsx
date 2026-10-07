"use client";

import { LazyMotion, MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Carga diferida de framer-motion (PERF-07). Los componentes usan `m.*` en vez de `motion.*`: el
 * `m` solo trae lo necesario para pintar, y las animaciones y gestos llegan aparte, en un chunk
 * que se pide con `import()`. Así framer no bloquea la hidratación de ninguna página.
 * `strict` hace que un `motion.*` dentro de la app falle en desarrollo, para que nadie vuelva a
 * meter el paquete entero en la ruta crítica sin darse cuenta.
 *
 * Consecuencia: hasta que llegan las funciones, un `m.*` se queda en su estado `initial`. Por eso
 * nada visible al cargar puede depender de una entrada de framer (si su `initial` lo oculta, se
 * vería en blanco hasta entonces); esas entradas van en CSS (PERF-04).
 *
 * Además, todas las animaciones de framer respetan `prefers-reduced-motion`: con
 * `reducedMotion="user"` framer desactiva las de transformación (posición, escala, rotación)
 * cuando el sistema lo pide, y mantiene las de opacidad, que no provocan malestar.
 *
 * Las animaciones de CSS (`animate-pulse`, `animate-in`, las transiciones de Tailwind) no pasan
 * por framer: esas se anulan desde `globals.css`. Las imperativas tampoco: `AnimatedNumber`
 * (`useReducedMotion`) y la sacudida de la partida (`useReducedMotionConfig`) lo comprueban por su
 * cuenta.
 */
const importFeatures = () => import("./motionFeatures").then((mod) => mod.default);

/**
 * La descarga empieza en cuanto se evalúa este módulo en el navegador, en paralelo a la
 * hidratación, y no en el efecto de montaje de `LazyMotion`, que llegaría después. Lo que aún
 * anima con framer al cargar (las barras de «Tu progreso», el anillo del perfil) arranca antes.
 */
const earlyFeatures = typeof window === "undefined" ? null : importFeatures();
const loadFeatures = () => earlyFeatures ?? importFeatures();

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
