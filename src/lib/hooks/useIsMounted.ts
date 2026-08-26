"use client";

import { useSyncExternalStore } from "react";

/** No hay store real al que suscribirse: el valor solo cambia una vez, al hidratar. */
const subscribeToNothing = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` en servidor y en el render de hidratación, `true` a partir de ahí.
 *
 * Sirve para lo que suele resolverse con `useState(false)` + `useEffect(() => setMounted(true))`:
 * pintar algo que depende de APIs del navegador (tema en localStorage, matchMedia…) sin
 * provocar un desajuste de hidratación. useSyncExternalStore lo expresa sin setState en
 * un efecto, que dispara un render en cascada y que el compilador de React marca como error.
 */
export function useIsMounted(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    getClientSnapshot,
    getServerSnapshot
  );
}
