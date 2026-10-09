import { formatGameDate } from "./format";

/**
 * Resumen legible del `details` de una fila de `ecos_system_logs`, por tipo de job. Cada
 * script (scripts/*.py) escribe su propio formato; aquí solo se lee, y todo campo ausente se
 * salta, porque las filas antiguas no tienen los que se añadieron después (`rule`, `pool_size`,
 * `no_preview_url`, `exhausted_playlists`...).
 */

type Details = Record<string, unknown>;

function asDetails(raw: unknown): Details | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Details) : null;
}

function num(d: Details, key: string): number | null {
  const v = d[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function text(d: Details, key: string): string | null {
  const v = d[key];
  return typeof v === "string" && v.trim() ? v : null;
}

function strings(d: Details, key: string): string[] {
  const v = d[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Une los pares «Etiqueta: valor» que existen. */
function pairs(d: Details, spec: [key: string, label: string][]): string | null {
  const parts: string[] = [];
  for (const [key, label] of spec) {
    const n = num(d, key);
    if (n !== null) parts.push(`${label}: ${n}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

const SHORT_BUCKET_LABELS: [key: string, label: string][] = [
  ["menos_de_15s", "< 15 s"],
  ["15_a_20s", "15–20 s"],
  ["20_a_25s", "20–25 s"],
  ["25s_o_mas", "≥ 25 s"],
];

const DAILY_GAME_RULES: Record<string, string> = {
  "2": "2 (playlist que no ha salido en la ventana de rotación)",
  "3-5": "3-5 (todas las playlists salieron; solo rotación de década, género y artista)",
  "6-fallback": "6 (sorteo de reserva: las reglas de rotación no dejaron candidatos)",
};

export type PlaylistRunStat = {
  name: string;
  line: string;
  exhausted: boolean;
  truncated: boolean;
  failed: boolean;
};

/** Estadísticas por playlist de una ingesta (`details.playlist_stats`). */
export function ingestionPlaylistStats(raw: unknown): PlaylistRunStat[] {
  const d = asDetails(raw);
  const list = d?.playlist_stats;
  if (!Array.isArray(list)) return [];
  const out: PlaylistRunStat[] = [];
  for (const item of list) {
    const s = asDetails(item);
    if (!s) continue;
    const name = text(s, "playlist") ?? text(s, "playlist_id") ?? "Sin nombre";
    if (s.status === "error") {
      out.push({
        name,
        line: `No leída: ${text(s, "error") ?? "error desconocido"}`,
        exhausted: false,
        truncated: false,
        failed: true,
      });
      continue;
    }
    const inPlaylist = num(s, "tracks_in_playlist");
    const processed = num(s, "tracks_processed");
    const parts: string[] = [];
    if (processed !== null) {
      parts.push(`procesadas ${processed}${inPlaylist !== null ? ` de ${inPlaylist}` : ""}`);
    }
    for (const [key, label] of [
      ["inserted", "insertadas"],
      ["duplicates", "duplicadas"],
      ["no_preview_url", "sin URL"],
      ["preview_short", "preview corto"],
      ["measure_failed", "fallo al medir"],
      ["deezer_found", "Deezer encontradas"],
      ["deezer_not_found", "Deezer no encontradas"],
      ["deezer_api_error", "fallo de Deezer"],
      ["eligible_by_deezer_only", "solo por Deezer"],
      ["enrich_failed", "fallo al leer"],
      ["unavailable", "retiradas"],
    ] as const) {
      const n = num(s, key);
      if (n) parts.push(`${label} ${n}`);
    }
    out.push({
      name,
      line: parts.join(" · "),
      exhausted: s.exhausted === true,
      truncated: s.possibly_truncated === true,
      failed: false,
    });
  }
  return out;
}

/**
 * Qué pasó con cada playlist en una ingesta, por `playlist_id`: agotada (todo lo que trae ya
 * estaba en el catálogo) y posible tope de 100 pistas. Vacío si el log no tiene `playlist_stats`.
 */
export function ingestionPlaylistFlags(
  raw: unknown
): Map<string, { exhausted: boolean; truncated: boolean }> {
  const out = new Map<string, { exhausted: boolean; truncated: boolean }>();
  const list = asDetails(raw)?.playlist_stats;
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    const s = asDetails(item);
    const id = s && text(s, "playlist_id");
    if (!s || !id || s.status === "error") continue;
    out.set(id, { exhausted: s.exhausted === true, truncated: s.possibly_truncated === true });
  }
  return out;
}

function ingestionLines(d: Details): string[] {
  const lines: string[] = [];
  const main = pairs(d, [
    ["playlists_checked", "Playlists"],
    ["playlists_failed", "No leídas"],
    ["tracks_found", "Revisadas"],
    ["duplicates", "Duplicadas"],
    ["songs_added", "Insertadas"],
  ]);
  if (main) lines.push(main);

  // Desde que se separaron las causas (`no_preview_url`...), `no_preview` es la suma de las tres;
  // en las filas antiguas era el único dato.
  if (num(d, "no_preview_url") !== null) {
    const parts: string[] = [];
    const sinUrl = num(d, "no_preview_url");
    if (sinUrl !== null) parts.push(`Sin URL de preview: ${sinUrl}`);
    const short = num(d, "preview_short");
    if (short !== null) {
      const raw = asDetails(d.preview_short_buckets);
      const buckets = raw
        ? SHORT_BUCKET_LABELS.flatMap(([key, label]) => {
            const n = typeof raw[key] === "number" ? (raw[key] as number) : 0;
            return n > 0 ? [`${label}: ${n}`] : [];
          })
        : [];
      const min = num(d, "min_preview_seconds");
      const umbral = min !== null ? ` (< ${min} s)` : "";
      parts.push(
        `Preview corto${umbral}: ${short}${buckets.length ? ` [${buckets.join(", ")}]` : ""}`
      );
    }
    const measure = num(d, "measure_failed");
    if (measure !== null) parts.push(`Fallo al medir: ${measure}`);
    const enrich = num(d, "enrich_failed");
    if (enrich !== null) parts.push(`Fallo al leer: ${enrich}`);
    const unavailable = num(d, "unavailable");
    if (unavailable !== null) parts.push(`Retiradas de Spotify: ${unavailable}`);
    lines.push(parts.join(" · "));
    // Desde la ingesta con Deezer: `no_preview` pasa a ser «sin audio en ninguna fuente».
    const noAudio = num(d, "no_audio");
    if (noAudio !== null) lines.push(`Sin audio en ninguna fuente: ${noAudio}`);
    const deezer = pairs(d, [
      ["deezer_found", "Encontradas en Deezer"],
      ["deezer_not_found", "No encontradas"],
      ["deezer_api_error", "Fallo de la API de Deezer"],
      ["deezer_short", "Preview corto en Deezer"],
      ["eligible_by_deezer_only", "Entran solo por Deezer"],
    ]);
    if (deezer) lines.push(deezer);
  } else {
    const legacy = num(d, "no_preview");
    if (legacy !== null) lines.push(`Sin preview: ${legacy}`);
  }

  const exhausted = strings(d, "exhausted_playlists");
  if (exhausted.length) lines.push(`Playlists agotadas: ${exhausted.join(", ")}`);

  const truncated = ingestionPlaylistStats(d).filter((p) => p.truncated);
  if (truncated.length) {
    lines.push(
      `Posible tope de 100 pistas de Spotify en ${truncated.length} ` +
        `${truncated.length === 1 ? "playlist" : "playlists"}: ` +
        truncated.map((p) => p.name).join(", ")
    );
  }

  const reasons = strings(d, "reasons");
  if (reasons.length) lines.push(`Motivos: ${reasons.join("; ")}`);
  const interrupted = text(d, "interrupted");
  if (interrupted) lines.push(`Interrumpida: ${interrupted}`);
  return lines;
}

function dailyGameLines(d: Details): string[] {
  if (d.skipped === true) return ["Ya existían los juegos de los próximos días"];
  const lines: string[] = [];
  const ident: string[] = [];
  const target = text(d, "target_date");
  if (target) ident.push(`Fecha: ${target}`);
  const number = num(d, "game_number");
  if (number !== null) ident.push(`Número: ${number}`);
  const title = text(d, "title");
  if (title) ident.push(`Título: ${title}`);
  const artist = text(d, "artist");
  if (artist) ident.push(`Artista: ${artist}`);
  const playlist = text(d, "playlist");
  if (playlist) ident.push(`Playlist: ${playlist}`);
  if (ident.length) lines.push(ident.join(" · "));

  const rule = text(d, "rule");
  if (rule) {
    const pool = num(d, "pool_size");
    const candidates = num(d, "candidates");
    const detail: string[] = [`Regla ${DAILY_GAME_RULES[rule] ?? rule}`];
    if (candidates !== null && pool !== null) {
      detail.push(`${candidates} candidatos de ${pool} canciones sin jugar`);
    } else if (pool !== null) {
      detail.push(`${pool} canciones sin jugar`);
    }
    lines.push(detail.join(" · "));
  }
  const error = text(d, "error");
  if (error) lines.push(`Error: ${error}`);
  return lines;
}

function notificationsLines(d: Details): string[] {
  const skipped = text(d, "skipped");
  if (skipped === "outside_window") {
    const hour = text(d, "madrid_time");
    return [`Omitida: fuera de la ventana de envío${hour ? ` (eran las ${hour} en Madrid)` : ""}`];
  }
  if (skipped === "no_game") return ["Omitida: no había juego de hoy"];
  const lines: string[] = [];
  const target = text(d, "target_date");
  if (target) lines.push(`Fecha: ${formatGameDate(target)}`);
  const stats = pairs(d, [
    ["sent", "Enviadas"],
    ["expired", "Expiradas"],
    ["pending", "Pendientes"],
    ["completed", "Ya jugaron"],
    ["total_subscriptions", "Suscripciones"],
  ]);
  if (stats) lines.push(stats);
  return lines;
}

function gamesCheckLines(d: Details): string[] {
  const lines: string[] = [];
  const dates = strings(d, "dates");
  const missing = strings(d, "missing");
  if (dates.length) {
    lines.push(
      `Fechas: ${dates.map(formatGameDate).join(", ")} · ` +
        (missing.length ? `Faltan: ${missing.map(formatGameDate).join(", ")}` : "cobertura completa")
    );
  }
  const warnings = strings(d, "warnings");
  if (warnings.length) lines.push(`Avisos: ${warnings.join("; ")}`);
  return lines;
}

function deezerBackfillLines(d: Details): string[] {
  const lines: string[] = [];
  const main = pairs(d, [
    ["songs_checked", "Canciones revisadas"],
    ["found", "Encontradas"],
    ["not_found", "No encontradas"],
    ["api_errors", "Fallo de la API"],
    ["short", "Preview corto"],
    ["became_eligible", "Pasan a elegibles"],
    ["updated", "Actualizadas"],
  ]);
  if (main) lines.push(main);
  const hosts = strings(d, "cdn_hosts");
  if (hosts.length) lines.push(`Hosts del CDN: ${hosts.join(", ")}`);
  if (d.recheck === true) lines.push("Con --recheck (incluye las ya buscadas sin éxito)");
  return lines;
}

function reportLines(d: Details): string[] {
  const parts: string[] = [];
  const title = text(d, "title");
  if (title) parts.push(`Canción: ${title}`);
  const reason = text(d, "reason");
  if (reason) parts.push(`Motivo: ${reason}`);
  const users = num(d, "distinct_users");
  if (users !== null) parts.push(`Usuarios distintos: ${users}`);
  return parts.length ? [parts.join(" · ")] : [];
}

function weeklyGamesLines(d: Details): string[] {
  const parts: string[] = [];
  const games = num(d, "games_created");
  if (games !== null) parts.push(`Juegos: ${games}`);
  const days = d.days;
  if (Array.isArray(days)) parts.push(`Días: ${days.length}`);
  const targets = d.target_dates;
  if (Array.isArray(targets)) parts.push(`Fechas: ${targets.length}`);
  return parts.length ? [parts.join(" · ")] : [];
}

/** Líneas de resumen del `details` de un log, ya en español. Vacío si no hay nada que mostrar. */
export function summarizeLog(jobType: string, raw: unknown): string[] {
  const d = asDetails(raw);
  if (!d) return [];
  switch (jobType) {
    case "ingestion":
      return ingestionLines(d);
    case "daily_game":
      return dailyGameLines(d);
    case "daily_notifications":
      return notificationsLines(d);
    case "games_check":
      return gamesCheckLines(d);
    case "deezer_backfill":
      return deezerBackfillLines(d);
    case "report_auto_deactivate":
      return reportLines(d);
    case "weekly_games":
      return weeklyGamesLines(d);
    default:
      return [];
  }
}
