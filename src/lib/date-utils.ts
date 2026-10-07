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
 * Fecha del juego actualmente jugable.
 * Coincide con el día natural en Madrid (nueva canción a las 00:00).
 */
export function getEffectiveGameDate(now: Date = new Date()): string {
  return getMadridDate(now);
}

/**
 * Normaliza a YYYY-MM-DD un valor de fecha (Postgres `date`, ISO con zona, etc.).
 * Útil para comparar `last_played` con fechas calculadas en Madrid sin fallos por formato.
 */
export function toDateKey(value: string | null | undefined): string | null {
  if (value == null || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  return null;
}

/**
 * Añade `days` a una fecha calendario YYYY-MM-DD (aritmética de calendario, sin zonas).
 */
export function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;

/**
 * Desplaza una clave de mes `YYYY-MM` `delta` meses (negativo hacia atrás). Aritmética de
 * calendario, sin zonas. Devuelve `null` si la clave no tiene ese formato.
 */
export function shiftMonthKey(monthKey: string, delta: number): string | null {
  const match = MONTH_KEY_RE.exec(monthKey);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Offset (ms) de Madrid respecto a UTC en el instante `utcMs`.
 * Positivo = Madrid va por delante de UTC (verano +2h, invierno +1h).
 */
function getMadridOffsetMs(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUTC - utcMs;
}

/**
 * Epoch (ms UTC) de las 00:00:00 hora Madrid de la fecha calendario `dateStr`.
 * Maneja DST correctamente (el offset a medianoche es estable; el cambio ocurre a las 02:00/03:00).
 */
function getMadridMidnightEpoch(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = getMadridOffsetMs(utcGuess);
  return utcGuess - offset;
}

/**
 * Fecha del día siguiente en Madrid (formato YYYY-MM-DD).
 * Útil para prefetch del home cuando faltan segundos para medianoche.
 */
export function getTomorrowMadridDate(now: Date = new Date()): string {
  return addCalendarDays(getMadridDate(now), 1);
}

/**
 * Día calendario anterior a todayMadrid (YYYY-MM-DD en Europe/Madrid).
 * Usar para rachas en lugar de Date.UTC(y, m-1, d-1) para alinear con el calendario local.
 */
export function getMadridYesterdayDateString(todayMadrid: string): string {
  return addCalendarDays(todayMadrid, -1);
}

/**
 * Milisegundos hasta la próxima medianoche (00:00) en Madrid.
 * Calcula el epoch real de la medianoche siguiente, por lo que es correcto
 * en los días de 23 h / 25 h de los cambios de horario (DST).
 */
export function getMsUntilNextMidnightMadrid(now: Date = new Date()): number {
  const tomorrow = addCalendarDays(getMadridDate(now), 1);
  const target = getMadridMidnightEpoch(tomorrow);
  const ms = target - now.getTime();
  return ms > 0 ? ms : 0;
}

/**
 * Segundos enteros (mínimo 1) hasta la próxima medianoche de Madrid. Para `revalidate` y
 * `s-maxage` de lo que cambia con el día de juego.
 */
export function getSecondsUntilNextMidnightMadrid(now: Date = new Date()): number {
  return Math.max(1, Math.ceil(getMsUntilNextMidnightMadrid(now) / 1000));
}
