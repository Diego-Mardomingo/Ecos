/**
 * Mientras llega el RSC del segmento: mismo fondo que la app para no mostrar skeleton
 * completo (el contenido útil llega en milisegundos; la caché cliente cubre el resto).
 */
export default function PlayGameLoading() {
  return <div className="min-h-dvh bg-background" aria-hidden />;
}
