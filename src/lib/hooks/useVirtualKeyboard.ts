"use client";

import { useSyncExternalStore } from "react";

/**
 * Alto mínimo (px) que debe ocupar la zona tapada para considerarla teclado.
 *
 * En Safari la franja inferior también se encoge por otros motivos (la barra de herramientas
 * que aparece y desaparece al hacer scroll), así que hace falta un umbral. Un teclado de iOS
 * nunca baja de ~250 px con la barra de sugerencias incluida; una barra de navegador ronda los
 * 50-90 px. 120 px deja hueco de sobra entre ambos.
 */
const KEYBOARD_MIN_HEIGHT_PX = 120;

/**
 * Parte del viewport de diseño que el viewport visual no muestra.
 *
 * En iOS el teclado NO encoge el viewport de diseño, solo el visual: `documentElement.clientHeight`
 * sigue valiendo lo mismo mientras `visualViewport.height` baja. La diferencia (descontando el
 * desplazamiento del viewport visual dentro del de diseño) es lo que tapa el teclado. Es la misma
 * cuenta que MDN documenta para emular `position: device-fixed`.
 */
function occludedHeight(viewport: VisualViewport): number {
  return (
    document.documentElement.clientHeight - viewport.height - viewport.offsetTop
  );
}

function subscribe(onStoreChange: () => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};

  viewport.addEventListener("resize", onStoreChange);
  viewport.addEventListener("scroll", onStoreChange);
  return () => {
    viewport.removeEventListener("resize", onStoreChange);
    viewport.removeEventListener("scroll", onStoreChange);
  };
}

function getSnapshot(): boolean {
  const viewport = window.visualViewport;
  if (!viewport) return false;

  // Con zoom de pellizco el viewport visual también se encoge, y ahí no hay teclado que
  // esquivar: reorganizar la pantalla mientras alguien se acerca a leer sería justo lo
  // contrario de lo que busca. El zoom se mantiene disponible a propósito (ver el viewport
  // de `[locale]/layout.tsx`), así que este caso hay que descartarlo explícitamente.
  if (viewport.scale > 1) return false;

  return occludedHeight(viewport) > KEYBOARD_MIN_HEIGHT_PX;
}

/** En servidor no hay teclado: la pantalla se renderiza siempre en su versión completa. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * `true` mientras el teclado virtual tapa una parte apreciable de la pantalla.
 *
 * Devuelve un booleano y no la altura a propósito: `visualViewport` emite `resize` en cada frame
 * de la animación de apertura del teclado, y con un número eso serían decenas de renders. Con el
 * umbral, el valor cambia una sola vez por apertura y por cierre.
 *
 * Va por `useSyncExternalStore` porque el viewport visual es una fuente externa de verdad; leerlo
 * en un efecto y volcarlo a estado rompería `react-hooks/set-state-in-effect` (ver CLAUDE.md).
 */
export function useIsVirtualKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
