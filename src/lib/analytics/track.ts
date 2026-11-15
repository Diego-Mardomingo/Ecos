/**
 * Eventos de analítica (Umami). Solo se envían desde producción en el dominio del sitio (ver
 * `UmamiScript`); en cualquier otro sitio `window.umami` no envía nada.
 *
 * Privacidad: el repo es público y la canción de un reto no resuelto no puede filtrarse. Ningún
 * dato lleva título, artista, id de canción o de partida ni id de usuario. Los tipos de abajo son
 * la lista cerrada de lo que se puede enviar: no añadas campos libres.
 */

type Modo = "hoy" | "historico";
type Sesion = "invitado" | "usuario";

export type AnalyticsEvents = {
  partida_primera_jugada: { modo: Modo; sesion: Sesion };
  partida_terminada: {
    resultado: "acierto" | "fallo";
    intento: number;
    modo: Modo;
    sesion: Sesion;
  };
  categoria_iniciada: { slug: string };
  categoria_terminada: { slug: string; racha: number };
  /** `resultado`: pantalla de fin de partida (GameResultScreen); `home`: botón de la home. */
  resultado_compartido: { origen: "resultado" | "home" };
  login_iniciado: undefined;
  registro_completado: undefined;
  push_activadas: undefined;
  reporte_enviado: undefined;
};

export type AnalyticsEventName = keyof AnalyticsEvents;

type UmamiData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track: (name?: string, data?: UmamiData) => unknown;
    };
  }
}

/** Los eventos sin datos no admiten un segundo argumento. */
type TrackArgs<E extends AnalyticsEventName> = AnalyticsEvents[E] extends undefined
  ? []
  : [datos: AnalyticsEvents[E]];

/**
 * Registra un evento. Nunca lanza ni hace nada si el tracker no está (bloqueador, SSR, aún sin
 * cargar). En desarrollo escribe el evento en consola para poder probarlo.
 */
export function track<E extends AnalyticsEventName>(evento: E, ...args: TrackArgs<E>): void {
  const datos = args[0] as UmamiData | undefined;
  try {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[analytics]", evento, datos);
    }
    if (typeof window === "undefined") return;
    window.umami?.track(evento, datos);
  } catch {
    // La analítica nunca puede romper el juego.
  }
}
