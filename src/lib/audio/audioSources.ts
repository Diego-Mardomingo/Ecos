/**
 * Contrato de `GET /api/audio-url?gameId=`: las fuentes de audio de una partida, por orden de
 * preferencia. Sin imports de servidor, para que el cliente lo comparta con la ruta.
 *
 * El cliente prueba las fuentes en orden y cae a la siguiente si una falla, así que el respaldo
 * viaja en la misma respuesta, sin otra ida y vuelta. Hoy solo hay Spotify; una fuente con URL
 * firmada (Deezer) se antepone a la lista con su `expiresAt`.
 */

export type AudioSourceName = "spotify" | "deezer";

export interface AudioSource {
  source: AudioSourceName;
  /** URL del MP3, directa del CDN. */
  url: string;
  /**
   * Instante (ms desde epoch) en que la URL deja de valer, o `null` si es permanente. El cliente
   * no debe usar ni guardar una URL con `expiresAt` pasado o muy próximo.
   */
  expiresAt: number | null;
}

export interface AudioUrlResponse {
  sources: AudioSource[];
}
