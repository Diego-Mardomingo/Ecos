/**
 * Funciones de framer-motion que se cargan aparte, con `import()` desde `MotionProvider`.
 *
 * `domMax` y no `domAnimation`: la app usa `layoutId` (onda de la partida, selectores, pestañas de
 * la home), `layout` (lista de intentos), arrastre (`BottomSheet`) y `onPan` (calendario de la
 * home), y eso solo viene en `domMax`.
 */
export { domMax as default } from "framer-motion";
