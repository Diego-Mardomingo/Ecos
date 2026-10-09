import type { AudioSource, AudioSourceName, AudioUrlResponse } from "@/lib/audio/audioSources";
import { audioDebugLog } from "@/lib/audio/audioDebug";

/**
 * Caché del audio por partida, a nivel de módulo (solo cliente).
 *
 * Por qué existe: antes cada `<audio>` bajaba el MP3 por su cuenta, y la pantalla de resultado
 * (otro `<audio>`) y cada revisita a la partida lo volvían a bajar. Aquí se resuelve la URL
 * (`/api/audio-url`), se descarga el MP3 entero **una vez** y se guarda como Blob: el reproductor
 * lo toca desde memoria, sin red y sin esperar al buffering del navegador.
 *
 * Estados: `idle → resolving → downloading → ready`, o `unavailable` (la partida no tiene audio) y
 * `error` (red o servidor: se puede reintentar).
 *
 * - Si ninguna descarga como Blob funciona (CORS, red) pero hay URL, queda `ready` con
 *   `blobUrl = null` y `directUrl`: el reproductor la pone tal cual en el `<audio>`.
 * - Se guardan como mucho `MAX_ENTRIES` partidas (LRU). Una entrada con algún reproductor montado
 *   (`acquireGameAudio`) no se expulsa, para no revocar un Blob en uso.
 * - `clearGameAudioStore` vacía todo al cerrar sesión (`clearSessionScopedClientData`).
 */

export type GameAudioStatus = "idle" | "resolving" | "downloading" | "ready" | "unavailable" | "error";

export interface GameAudioSnapshot {
  status: GameAudioStatus;
  /** Blob del MP3 en memoria, listo para un `<audio>`. `null` mientras no hay o si se usa `directUrl`. */
  blobUrl: string | null;
  /** URL del CDN para poner directa en el `<audio>` cuando no se pudo descargar el Blob. */
  directUrl: string | null;
  /** Fuente de la que salió el audio (o de la `directUrl`). */
  source: AudioSourceName | null;
  /** Causa del último fallo, para el diagnóstico. Solo con `status: "error"`. */
  error: string | null;
}

/**
 * Referencia estable para «sin entrada»: `getSnapshot` de `useSyncExternalStore` debe devolver el
 * mismo objeto mientras nada cambie.
 */
export const IDLE_GAME_AUDIO: GameAudioSnapshot = {
  status: "idle",
  blobUrl: null,
  directUrl: null,
  source: null,
  error: null,
};

const MAX_ENTRIES = 3;
/** Una URL que caduca antes de esto se da por caducada: no daría tiempo a bajarla. */
const MIN_URL_LIFE_MS = 60_000;
const RESOLVE_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;

interface Entry {
  snapshot: GameAudioSnapshot;
  /** Reproductores montados sobre esta entrada. Con alguno, no se expulsa. */
  users: number;
  inflight: Promise<void> | null;
  /** Se incrementa al reintentar, expulsar o limpiar: una carga con otra generación se descarta. */
  generation: number;
}

/** El orden de inserción es el de uso: el primero es el menos reciente. */
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

/** Identificador corto de la partida para el diagnóstico (igual que `gameLabel` de `audioDebug`). */
export function gameAudioLabel(gameId: string): string {
  return gameId.slice(0, 8);
}

function notify(gameId: string) {
  const set = listeners.get(gameId);
  if (!set) return;
  for (const listener of set) listener();
}

export function subscribeGameAudio(gameId: string, listener: () => void): () => void {
  let set = listeners.get(gameId);
  if (!set) {
    set = new Set();
    listeners.set(gameId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(gameId) === set) listeners.delete(gameId);
  };
}

/** Lectura pura (no crea entradas, no toca el LRU): la usa `getSnapshot` en cada render. */
export function getGameAudioSnapshot(gameId: string): GameAudioSnapshot {
  return entries.get(gameId)?.snapshot ?? IDLE_GAME_AUDIO;
}

function revoke(snapshot: GameAudioSnapshot) {
  if (snapshot.blobUrl) URL.revokeObjectURL(snapshot.blobUrl);
}

function setSnapshot(gameId: string, entry: Entry, patch: Partial<GameAudioSnapshot>) {
  entry.snapshot = { ...entry.snapshot, ...patch };
  notify(gameId);
}

function evict(gameId: string, entry: Entry) {
  entry.generation++;
  entry.inflight = null;
  revoke(entry.snapshot);
  entries.delete(gameId);
  notify(gameId);
}

/** Expulsa las entradas más antiguas sin reproductor hasta quedar en `MAX_ENTRIES`. */
function trim(keep?: string) {
  if (entries.size <= MAX_ENTRIES) return;
  for (const [gameId, entry] of entries) {
    if (entries.size <= MAX_ENTRIES) return;
    if (entry.users > 0 || gameId === keep) continue;
    audioDebugLog(gameAudioLabel(gameId), "store", "expulsada (LRU)");
    evict(gameId, entry);
  }
}

/** Devuelve la entrada de la partida (creándola) y la marca como la más reciente. */
function touch(gameId: string): Entry {
  let entry = entries.get(gameId);
  if (entry) {
    entries.delete(gameId);
  } else {
    entry = { snapshot: IDLE_GAME_AUDIO, users: 0, inflight: null, generation: 0 };
  }
  entries.set(gameId, entry);
  trim(gameId);
  return entry;
}

// ---------------------------------------------------------------------------------------------
// Resolver y descargar
// ---------------------------------------------------------------------------------------------

type ResolveResult =
  | { kind: "ok"; sources: AudioSource[] }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

async function resolveSources(gameId: string): Promise<ResolveResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/audio-url?gameId=${encodeURIComponent(gameId)}`, {
      signal: controller.signal,
    });
    // 404: el juego no existe o no tiene audio. No se arregla reintentando.
    if (response.status === 404) return { kind: "unavailable" };
    if (!response.ok) return { kind: "error", message: `audio-url HTTP ${response.status}` };
    const body = (await response.json()) as Partial<AudioUrlResponse>;
    const sources = Array.isArray(body.sources)
      ? body.sources.filter((s) => typeof s?.url === "string" && s.url.startsWith("https://"))
      : [];
    if (sources.length === 0) return { kind: "error", message: "audio-url sin fuentes" };
    return { kind: "ok", sources };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : "audio-url falló" };
  } finally {
    clearTimeout(timer);
  }
}

/** Baja el MP3 entero. Lanza si hay un error de red, de CORS, un HTTP no 2xx o un cuerpo vacío. */
async function downloadBlob(url: string): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size === 0) throw new Error("respuesta vacía");
    // Safari decide el códec por el tipo del Blob: si el CDN no manda uno de audio, se fija.
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/mpeg" });
  } finally {
    clearTimeout(timer);
  }
}

function isUsable(source: AudioSource): boolean {
  return source.expiresAt === null || source.expiresAt - Date.now() >= MIN_URL_LIFE_MS;
}

function elapsed(since: number): number {
  return Math.round(performance.now() - since);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "error desconocido";
}

async function runLoad(gameId: string, entry: Entry, generation: number): Promise<void> {
  const label = gameAudioLabel(gameId);
  const current = () => entry.generation === generation && entries.get(gameId) === entry;

  setSnapshot(gameId, entry, { ...IDLE_GAME_AUDIO, status: "resolving" });
  const resolveStart = performance.now();
  const resolved = await resolveSources(gameId);
  if (!current()) return;

  if (resolved.kind === "unavailable") {
    audioDebugLog(label, "resolver", `sin audio (404) · ${elapsed(resolveStart)} ms`);
    setSnapshot(gameId, entry, { status: "unavailable" });
    return;
  }
  if (resolved.kind === "error") {
    audioDebugLog(label, "resolver", `error: ${resolved.message} · ${elapsed(resolveStart)} ms`);
    setSnapshot(gameId, entry, { status: "error", error: resolved.message });
    return;
  }

  const usable = resolved.sources.filter(isUsable);
  audioDebugLog(
    label,
    "resolver",
    `${elapsed(resolveStart)} ms · ${usable.map((s) => s.source).join(", ") || "ninguna fuente vigente"}`
  );
  if (usable.length === 0) {
    setSnapshot(gameId, entry, { status: "error", error: "URL caducada" });
    return;
  }

  setSnapshot(gameId, entry, { status: "downloading" });
  const failures: string[] = [];
  for (const [index, source] of usable.entries()) {
    const downloadStart = performance.now();
    try {
      const blob = await downloadBlob(source.url);
      // Entre medias pudo reintentarse o expulsarse la entrada: no crear un Blob que nadie revoque.
      if (!current()) return;
      const blobUrl = URL.createObjectURL(blob);
      audioDebugLog(
        label,
        "descarga",
        `${source.source} · ${elapsed(downloadStart)} ms · ${Math.round(blob.size / 1024)} KB${index > 0 ? " · respaldo" : ""}`
      );
      setSnapshot(gameId, entry, { status: "ready", blobUrl, directUrl: null, source: source.source });
      return;
    } catch (err) {
      if (!current()) return;
      failures.push(`${source.source}: ${errorMessage(err)}`);
      audioDebugLog(label, "descarga", `${source.source} falló: ${errorMessage(err)} · ${elapsed(downloadStart)} ms`);
    }
  }

  // Ninguna descarga como Blob funcionó (CORS, red, caducidad): se deja la URL directa al
  // `<audio>`, que el `media-src` de la CSP permite. Si tampoco carga, el reproductor avisa del
  // error y el reintento vuelve a empezar desde aquí.
  const [fallback] = usable;
  audioDebugLog(label, "directo", `sin Blob (${failures.join(" · ")}); URL directa de ${fallback.source}`);
  setSnapshot(gameId, entry, {
    status: "ready",
    blobUrl: null,
    directUrl: fallback.url,
    source: fallback.source,
  });
}

function startLoad(gameId: string, entry: Entry): Promise<void> {
  const generation = ++entry.generation;
  const promise = runLoad(gameId, entry, generation).then(() => {
    if (entry.generation === generation) entry.inflight = null;
  });
  entry.inflight = promise;
  return promise;
}

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

/**
 * Carga el audio de la partida. Idempotente: con una carga en curso devuelve esa misma promesa, y
 * con el audio ya listo (o sin audio) no hace nada. Tras un error vuelve a intentarlo, así que un
 * reproductor que monta de nuevo no se queda con el fallo viejo. Nunca rechaza.
 */
export function loadGameAudio(gameId: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const entry = touch(gameId);
  if (entry.inflight) return entry.inflight;
  const { status } = entry.snapshot;
  if (status === "ready" || status === "unavailable") return Promise.resolve();
  return startLoad(gameId, entry);
}

/**
 * Precarga sin reproductor: igual que `loadGameAudio`, pero respeta el ahorro de datos y no
 * reintenta un fallo anterior (nadie está esperando este audio).
 */
export function prefetchGameAudio(gameId: string): void {
  if (typeof window === "undefined") return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  const existing = entries.get(gameId);
  if (existing && existing.snapshot.status !== "idle") return;
  void loadGameAudio(gameId);
}

/** Reintento explícito (botón de reintentar): descarta lo que hubiera y empieza de cero. */
export function retryGameAudio(gameId: string): void {
  if (typeof window === "undefined") return;
  const entry = touch(gameId);
  audioDebugLog(gameAudioLabel(gameId), "store", "reintento");
  revoke(entry.snapshot);
  entry.snapshot = IDLE_GAME_AUDIO;
  void startLoad(gameId, entry);
}

/**
 * Anota un reproductor montado sobre la partida: mientras haya alguno, la entrada no se expulsa.
 * Devuelve la función que lo libera.
 */
export function acquireGameAudio(gameId: string): () => void {
  const entry = touch(gameId);
  entry.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.users = Math.max(0, entry.users - 1);
    trim();
  };
}

/**
 * Vacía la caché (cierre de sesión o cambio de usuario) y revoca todos los Blob. Las entradas con
 * un reproductor montado se quedan en `idle` para que este las vuelva a cargar, y el resto se borra.
 */
export function clearGameAudioStore(): void {
  for (const [gameId, entry] of [...entries]) {
    entry.generation++;
    entry.inflight = null;
    revoke(entry.snapshot);
    entry.snapshot = IDLE_GAME_AUDIO;
    if (entry.users === 0) entries.delete(gameId);
    notify(gameId);
  }
}
