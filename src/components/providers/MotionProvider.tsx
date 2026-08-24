"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Hace que **todas** las animaciones de framer-motion respeten `prefers-reduced-motion`.
 *
 * Con `reducedMotion="user"` framer desactiva las animaciones de transformación (posición,
 * escala, rotación) cuando el sistema lo pide, y mantiene las de opacidad, que no provocan
 * malestar. Así no hay que repetir el `useReducedMotion()` que `marquee-text` ya hacía a mano en
 * cada uno de los 11 componentes que importan framer-motion.
 *
 * Las animaciones de CSS (`animate-pulse`, `animate-in`, las transiciones de Tailwind) no pasan
 * por framer: esas se anulan desde `globals.css`.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
