import { notFound } from "next/navigation";

/**
 * Comodín de rutas desconocidas bajo un idioma válido. Sin él, un `/en/no-existe` no casaba con
 * ninguna ruta de `[locale]` y se servía el 404 de raíz (sin estilos y con `lang="es"`). Al
 * lanzar `notFound()` desde aquí lo recoge `[locale]/not-found.tsx`, ya traducido y con el layout.
 * Las rutas reales (`/admin`, `/play`…) son más específicas y no pasan por aquí; `/api` y
 * `/serwist` viven fuera de `[locale]`.
 */
export default function CatchAllNotFound() {
  notFound();
}
