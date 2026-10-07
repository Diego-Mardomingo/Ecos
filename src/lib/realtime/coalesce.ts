/**
 * Ventana de agrupación de los avisos de Realtime, en ms, y dispersión aleatoria que se le suma.
 *
 * Cuando alguien cierra una partida, el aviso llega a **todos** los espectadores a la vez. Sin
 * agrupar, cada uno recargaría el ranking una vez por partida; sin dispersar, todos lo harían en el
 * mismo instante. Con esto, cada espectador recarga como mucho una vez por ventana, sean cuantos
 * sean los avisos, y las recargas se reparten en el tiempo.
 */
const COALESCE_WINDOW_MS = 1500;
const COALESCE_JITTER_MS = 2500;

/**
 * Agrupa ráfagas de avisos en una sola ejecución.
 *
 * El primer aviso arma un temporizador; los que lleguen mientras corre se absorben; al vencer
 * ejecuta `run` una vez. Es una ventana fija, no un antirrebote: una racha continua de avisos no
 * puede retrasar la recarga indefinidamente.
 *
 * Se crea dentro del efecto que abre el canal, y su `cancel()` va en el cleanup para que no quede
 * un temporizador pendiente tras desmontar.
 */
export function createEventCoalescer(run: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule() {
      if (timer) return;
      timer = setTimeout(
        () => {
          timer = null;
          run();
        },
        COALESCE_WINDOW_MS + Math.random() * COALESCE_JITTER_MS
      );
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
