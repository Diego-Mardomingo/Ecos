/**
 * Utilidades de fecha para el juego diario.
 * Rollover a las 16:00 hora España (Europe/Madrid) con cambio de horario.
 */

const MADRID = "Europe/Madrid";

/**
 * Fecha de hoy en Madrid (solo fecha, sin rollover).
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
 * Antes de las 16:00 Madrid: juego de ayer.
 * A las 16:00 y después: juego de hoy.
 */
export function getEffectiveGameDate(now: Date = new Date()): string {
  const hour = getMadridHour(now);
  const today = getMadridDate(now);
  if (hour >= 16) return today;
  const [y, m, d] = today.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

/**
 * Milisegundos hasta la próxima 16:00 en Madrid.
 * Si ya pasaron las 16:00 hoy, devuelve ms hasta mañana 16:00.
 */
export function getMsUntilNext16hMadrid(now: Date = new Date()): number {
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
  const msUntil16h = 16 * 3600 * 1000 - msFromMidnight;
  if (msUntil16h <= 0) return msUntil16h + 24 * 3600 * 1000;
  return msUntil16h;
}
