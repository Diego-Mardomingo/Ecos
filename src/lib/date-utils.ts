/**
 * Utilidades de fecha para el juego diario.
 * Rollover a las 00:00 hora España (Europe/Madrid).
 */

const MADRID = "Europe/Madrid";

/**
 * Fecha de hoy en Madrid (formato YYYY-MM-DD).
 */
export function getMadridDate(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now); // YYYY-MM-DD
}

/**
 * Hora actual en Madrid (0-23).
 */
export function getMadridHour(now: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID,
    hour: "2-digit",
    hour12: false,
  });
  return parseInt(formatter.format(now), 10);
}

/**
 * Fecha del juego actualmente jugable.
 * Coincide con el día natural en Madrid (nueva canción a las 00:00).
 */
export function getEffectiveGameDate(now: Date = new Date()): string {
  return getMadridDate(now);
}

/**
 * Fecha del día siguiente en Madrid (formato YYYY-MM-DD).
 * Útil para prefetch del home cuando faltan segundos para medianoche.
 */
export function getTomorrowMadridDate(now: Date = new Date()): string {
  const atNextMidnight = new Date(now.getTime() + getMsUntilNextMidnightMadrid(now));
  return getMadridDate(atNextMidnight);
}

/**
 * Milisegundos hasta la próxima medianoche (00:00) en Madrid.
 */
export function getMsUntilNextMidnightMadrid(now: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  const h = parseInt(get("hour"), 10);
  const m = parseInt(get("minute"), 10);
  const s = parseInt(get("second"), 10);
  const msFromMidnight = (h * 3600 + m * 60 + s) * 1000;
  const msInDay = 24 * 3600 * 1000;
  return msInDay - msFromMidnight;
}

/**
 * @deprecated Usar getMsUntilNextMidnightMadrid. Mantenido por compatibilidad.
 */
export function getMsUntilNext16hMadrid(now: Date = new Date()): number {
  return getMsUntilNextMidnightMadrid(now);
}
