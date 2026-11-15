/**
 * Eventos de analítica (Umami). Solo se envían desde producción en el dominio del sitio (ver
 * `UmamiScript`); en cualquier otro sitio `window.umami` no envía nada.
 *
 * Privacidad: el repo es público y la canción de un reto no resuelto no puede filtrarse. Ningún
 * dato lleva título, artista, id de canción o de partida ni id de usuario. Los tipos de abajo son
 * la lista cerrada de lo que se puede enviar: no añadas campos libres.
 */

type Modo = "hoy" | "historico";
export type Sesion = "invitado" | "usuario";
type CategoriaMotivo = "fallo" | "abandono" | "agotada";
type LoginOrigen = "partida" | "categorias" | "ranking" | "perfil" | "inicio";

export type AnalyticsEvents = {
  partida_primera_jugada: { modo: Modo; sesion: Sesion };
  partida_terminada: {
    resultado: "acierto" | "fallo";
    intento: number;
    modo: Modo;
    sesion: Sesion;
  };
  categoria_iniciada: { slug: string };
  /** `motivo`: `end_reason` de la racha (`failed`, `abandoned`, `exhausted`). */
  categoria_terminada: { slug: string; racha: number; motivo: CategoriaMotivo };
  /** `resultado`: pantalla de fin de partida (GameResultScreen); `home`: botón de la home. */
  resultado_compartido: { origen: "resultado" | "home" };
  /** `origen`: sección de la que venía quien entra (sale del destino tras el login). */
  login_iniciado: { origen: LoginOrigen };
  registro_completado: undefined;
  push_activadas: undefined;
  /**
   * Una fuente de audio falló al cargar la partida (una vez por carga). `fuente` es la que falló;
   * `recuperado`, si otra la sustituyó. Ver `audioStore.ts`.
   */
  audio_fallo: { fuente: "deezer" | "spotify"; recuperado: boolean };
};

export type AnalyticsEventName = keyof AnalyticsEvents;

type UmamiData = Record<string, string | number | boolean>;

/**
 * Datos de sesión de `identify`. Lista cerrada y **sin clave `id`**: el tracker la toma como id de
 * usuario, y aquí no se identifica a nadie.
 */
type SessionData = { sesion: Sesion; pwa: boolean };

declare global {
  interface Window {
    umami?: {
      track: (name?: string, data?: UmamiData) => unknown;
      identify: (data: UmamiData) => unknown;
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

/**
 * Añade la marca de campaña de un enlace compartido (`utm_source=share`). `UmamiScript` descarta
 * el resto de la query y conserva solo los `utm_*`, que Umami lee del servidor.
 */
export function withShareCampaign(url: string, medium: "resultado" | "home"): string {
  return `${url}?utm_source=share&utm_medium=${medium}`;
}

/**
 * Datos de sesión (`identify`) enviados a Umami: `sesion` (invitado o con cuenta) y `pwa` (instalada
 * en pantalla de inicio). No llevan ningún identificador.
 *
 * Dos cosas pueden llegar primero: el estado de sesión (`AuthProvider`) o el tracker (script
 * `afterInteractive`). `identifySession` guarda lo pedido y lo envía en cuanto `window.umami`
 * existe; `onTrackerLoad`, que `UmamiScript` pasa al `onLoad` del tracker, lo reintenta al cargar.
 * Un envío idéntico al anterior se omite (StrictMode, re-renders), y uno distinto (cerrar sesión
 * sin recarga) vuelve a identificar.
 */
let wantedSession: Sesion | null = null;
let sentSessionKey: string | null = null;

function isStandalonePwa(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.matchMedia("(display-mode: standalone)").matches || iosStandalone;
}

function sendSession(): void {
  try {
    if (typeof window === "undefined" || !wantedSession || !window.umami?.identify) return;
    const datos: SessionData = { sesion: wantedSession, pwa: isStandalonePwa() };
    const key = `${datos.sesion}|${datos.pwa}`;
    if (key === sentSessionKey) return;
    sentSessionKey = key;
    if (process.env.NODE_ENV !== "production") console.debug("[analytics] identify", datos);
    window.umami.identify(datos);
  } catch {
    // La analítica nunca puede romper el juego.
  }
}

export function identifySession(sesion: Sesion): void {
  wantedSession = sesion;
  sendSession();
}

/** `onLoad` del script del tracker: envía lo que estuviera esperando a que `window.umami` existiera. */
export function onTrackerLoad(): void {
  sendSession();
}
