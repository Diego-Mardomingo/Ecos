/**
 * Formato de fechas del panel de admin. Todo en hora de Madrid: el servidor corre en UTC y
 * `date-fns/format` con `new Date(iso)` pintaba la hora del proceso, una o dos horas por detrás
 * de la que ven los jobs de GitHub Actions (y el día de juego).
 */

const MADRID = "Europe/Madrid";

const dateTimeFormat = new Intl.DateTimeFormat("es-ES", {
  timeZone: MADRID,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `dd/MM/yyyy HH:mm` en hora de Madrid, o cadena vacía si no hay fecha. */
export function formatAdminDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    dateTimeFormat.formatToParts(date).map((p) => [p.type, p.value])
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** `YYYY-MM-DD` (fecha de juego) como `dd/MM/yyyy`. */
export function formatGameDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}

/** Horas transcurridas entre `iso` y `nowMs`. */
export function ageHours(iso: string, nowMs: number): number {
  return (nowMs - new Date(iso).getTime()) / 3_600_000;
}

/** «hace 25 min», «hace 7 h», «hace 3 días». */
export function formatAge(hours: number): string {
  if (hours < 0) return "ahora";
  if (hours < 1) return `hace ${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `hace ${Math.round(hours)} h`;
  return `hace ${Math.floor(hours / 24)} días`;
}
