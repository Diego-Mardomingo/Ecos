/**
 * Ventana de agrupación de eventos de realtime.
 *
 * En hora punta llegan muchos INSERT de `ecos_scores` casi a la vez, porque todo el mundo termina
 * el reto del día a la vez. Sin agrupar, cada cliente conectado recarga una vez por cada partida
 * que cierra cualquier usuario: un patrón que se amplifica solo.
 */
export const REALTIME_COALESCE_MS = 4000;

/**
 * Agrupa ráfagas de eventos en una sola ejecución, `delayMs` después del último.
 *
 * Se crea dentro del efecto que abre el canal, y su `cancel()` va en el cleanup para que no quede
 * un timer pendiente tras desmontar.
 */
export function createEventCoalescer(
  run: () => void,
  delayMs: number = REALTIME_COALESCE_MS
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
