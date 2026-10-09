/**
 * Diagnóstico del audio: mide carga, arranque y duración real de los fragmentos en cualquier
 * dispositivo, para comparar con números y no por sensaciones.
 *
 * Se activa abriendo cualquier página con `?audioDebug=1` (carga completa, no navegación interna)
 * y dura lo que la pestaña (`sessionStorage`); `?audioDebug=0` lo apaga. Desactivado, todas las
 * funciones de registro salen en la primera línea: no cuesta nada al resto de usuarios.
 *
 * El reproductor solo avisa de tres cosas (se crea un `<audio>`, se pide play, se para); los
 * eventos del elemento y las descargas se recogen aquí.
 */

const STORAGE_KEY = "ecos_audio_debug";
const MAX_EVENTS = 60;
const MAX_PLAYS = 20;
const MAX_DOWNLOADS = 20;

/** Eventos del `<audio>` que se registran. Sin `timeupdate` ni `progress`: son ruido. */
const MEDIA_EVENTS = [
  "loadstart",
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "canplaythrough",
  "play",
  "playing",
  "waiting",
  "stalled",
  "seeking",
  "seeked",
  "pause",
  "ended",
  "error",
] as const;

/** URLs de audio cuyas descargas interesan: el proxy y los CDN de las fuentes. */
const AUDIO_RESOURCE_PATTERN = /\/api\/audio-|p\.scdn\.co|dzcdn\.net/;

export interface AudioDebugEvent {
  /** ms desde el inicio de la navegación (`performance.now()`). */
  at: number;
  game: string;
  event: string;
  detail: string;
}

export interface AudioDebugLoad {
  game: string;
  createdAt: number;
  /** ms desde que se creó el `<audio>` hasta cada evento de carga. */
  metadataMs: number | null;
  loadedDataMs: number | null;
  canPlayThroughMs: number | null;
  errors: number;
}

export interface AudioDebugPlay {
  game: string;
  /** Segundos del fragmento que debía sonar. */
  expected: number;
  startAt: number;
  /** Del toque (petición de play) al evento `playing`. */
  tapToPlayingMs: number | null;
  /** Avance del cabezal entre el play y la parada, en segundos. */
  mediaPlayed: number | null;
  /** Tiempo de reloj entre `playing` y la pausa, en segundos. */
  wallPlayed: number | null;
}

export interface AudioDebugDownload {
  at: number;
  name: string;
  /** `null` cuando el navegador no da datos (petición a otro origen sin Timing-Allow-Origin). */
  transferKb: number | null;
  bodyKb: number | null;
  fromCache: boolean | null;
  ttfbMs: number | null;
  durationMs: number;
}

export interface AudioDebugState {
  events: AudioDebugEvent[];
  loads: AudioDebugLoad[];
  plays: AudioDebugPlay[];
  downloads: AudioDebugDownload[];
}

const EMPTY_STATE: AudioDebugState = { events: [], loads: [], plays: [], downloads: [] };

let state: AudioDebugState = EMPTY_STATE;
const listeners = new Set<() => void>();
let enabledCache: boolean | null = null;
let resourceObserverStarted = false;

/** Reproducción en curso por elemento, entre la petición de play y la parada. */
interface PendingPlay {
  game: string;
  expected: number;
  startAt: number;
  tapAt: number;
  playingAt: number | null;
  pausedAt: number | null;
}
const pendingPlays = new WeakMap<HTMLAudioElement, PendingPlay>();
const loadIndexByAudio = new WeakMap<HTMLAudioElement, AudioDebugLoad>();

function emit(next: AudioDebugState) {
  state = next;
  for (const listener of listeners) listener();
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Identificador corto de la partida a partir de la URL del audio (`gameId=…`). */
function gameLabel(src: string): string {
  const match = /gameId=([0-9a-f-]{8})/i.exec(src);
  return match ? match[1] : src.slice(-8);
}

function readEnabled(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("audioDebug");
    if (param === "1") sessionStorage.setItem(STORAGE_KEY, "1");
    else if (param === "0") sessionStorage.removeItem(STORAGE_KEY);
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // sessionStorage bloqueado (modo privado antiguo, políticas del navegador): sin diagnóstico.
    return false;
  }
}

/**
 * Se decide una vez por carga de página: el parámetro se lee al primer uso. Activado, el estado
 * queda también en `window.__ecosAudioDebug()` para las medidas automáticas con Playwright.
 */
export function isAudioDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (enabledCache === null) {
    enabledCache = readEnabled();
    if (enabledCache) {
      (window as Window & { __ecosAudioDebug?: () => AudioDebugState }).__ecosAudioDebug = () => state;
    }
  }
  return enabledCache;
}

export function subscribeAudioDebug(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAudioDebugState(): AudioDebugState {
  return state;
}

export function getAudioDebugServerState(): AudioDebugState {
  return EMPTY_STATE;
}

export function clearAudioDebug() {
  emit(EMPTY_STATE);
}

/** Apunta un evento suelto. Para el motor de audio y el resolvedor, además de los del elemento. */
export function audioDebugLog(game: string, event: string, detail = "") {
  if (!isAudioDebugEnabled()) return;
  const entry: AudioDebugEvent = { at: round(performance.now()), game, event, detail };
  emit({ ...state, events: [entry, ...state.events].slice(0, MAX_EVENTS) });
}

function describeMedia(audio: HTMLAudioElement): string {
  const buffered = audio.buffered.length
    ? audio.buffered.end(audio.buffered.length - 1).toFixed(1)
    : "0";
  return `pos ${audio.currentTime.toFixed(3)} · rs ${audio.readyState} · buf ${buffered} s`;
}

function updateLoad(audio: HTMLAudioElement, patch: Partial<AudioDebugLoad>) {
  const current = loadIndexByAudio.get(audio);
  if (!current) return;
  const next = { ...current, ...patch };
  loadIndexByAudio.set(audio, next);
  emit({ ...state, loads: state.loads.map((load) => (load === current ? next : load)) });
}

function onMediaEvent(audio: HTMLAudioElement, game: string, name: string) {
  const now = performance.now();
  const load = loadIndexByAudio.get(audio);
  const sinceCreated = load ? round(now - load.createdAt) : null;

  if (load) {
    if (name === "loadedmetadata" && load.metadataMs === null) updateLoad(audio, { metadataMs: sinceCreated });
    if (name === "loadeddata" && load.loadedDataMs === null) updateLoad(audio, { loadedDataMs: sinceCreated });
    if (name === "canplaythrough" && load.canPlayThroughMs === null) {
      updateLoad(audio, { canPlayThroughMs: sinceCreated });
    }
    if (name === "error") updateLoad(audio, { errors: load.errors + 1 });
  }

  const pending = pendingPlays.get(audio);
  if (pending) {
    if (name === "playing" && pending.playingAt === null) pending.playingAt = now;
    if (name === "pause") pending.pausedAt = now;
  }

  const code = name === "error" && audio.error ? ` · código ${audio.error.code}` : "";
  audioDebugLog(game, name, `+${sinceCreated ?? "?"} ms · ${describeMedia(audio)}${code}`);
}

function startResourceObserver() {
  if (resourceObserverStarted || typeof PerformanceObserver === "undefined") return;
  resourceObserverStarted = true;
  try {
    const observer = new PerformanceObserver((list) => {
      const found: AudioDebugDownload[] = [];
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        if (!AUDIO_RESOURCE_PATTERN.test(entry.name)) continue;
        // Otro origen sin Timing-Allow-Origin: el navegador pone tamaños y tiempos a cero.
        const opaque = entry.encodedBodySize === 0 && entry.transferSize === 0;
        found.push({
          at: round(entry.startTime),
          name: entry.name.replace(/^https?:\/\//, "").split("?")[0].slice(-40),
          transferKb: opaque ? null : round(entry.transferSize / 1024, 1),
          bodyKb: opaque ? null : round(entry.encodedBodySize / 1024, 1),
          fromCache: opaque ? null : entry.transferSize === 0,
          ttfbMs: entry.responseStart > 0 ? round(entry.responseStart - entry.startTime) : null,
          durationMs: round(entry.duration),
        });
      }
      if (found.length > 0) {
        emit({ ...state, downloads: [...found, ...state.downloads].slice(0, MAX_DOWNLOADS) });
      }
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    // Navegador sin Resource Timing observable: el panel sale sin la lista de descargas.
  }
}

/**
 * Engancha el diagnóstico a un `<audio>` recién creado. Devuelve la función que lo suelta, para
 * la limpieza del efecto que lo creó.
 */
export function attachAudioDebug(audio: HTMLAudioElement, src: string): () => void {
  if (!isAudioDebugEnabled()) return () => {};
  startResourceObserver();

  const game = gameLabel(src);
  const load: AudioDebugLoad = {
    game,
    createdAt: performance.now(),
    metadataMs: null,
    loadedDataMs: null,
    canPlayThroughMs: null,
    errors: 0,
  };
  loadIndexByAudio.set(audio, load);
  emit({ ...state, loads: [load, ...state.loads].slice(0, MAX_PLAYS) });
  audioDebugLog(game, "creado", src.split("?")[0]);

  const handlers = MEDIA_EVENTS.map((name) => {
    const handler = () => onMediaEvent(audio, game, name);
    audio.addEventListener(name, handler);
    return [name, handler] as const;
  });
  return () => {
    for (const [name, handler] of handlers) audio.removeEventListener(name, handler);
    pendingPlays.delete(audio);
  };
}

/** El usuario ha pedido reproducir: arranca la medida del fragmento. */
export function audioDebugPlayRequested(audio: HTMLAudioElement, startAt: number, expected: number) {
  if (!isAudioDebugEnabled()) return;
  const load = loadIndexByAudio.get(audio);
  pendingPlays.set(audio, {
    game: load?.game ?? "?",
    expected,
    startAt,
    tapAt: performance.now(),
    playingAt: null,
    pausedAt: null,
  });
}

/**
 * El reproductor va a parar (fin de fragmento, stop del usuario o corte de seguridad). Se llama
 * antes de devolver el cabezal a 0, para leer hasta dónde llegó.
 */
export function audioDebugStopped(audio: HTMLAudioElement) {
  if (!isAudioDebugEnabled()) return;
  const pending = pendingPlays.get(audio);
  if (!pending) return;
  pendingPlays.delete(audio);

  const now = performance.now();
  // Si la pausa llegó antes (fin de fragmento), cuenta esa; si no, la parada es ahora.
  const stoppedAt =
    pending.pausedAt !== null && pending.playingAt !== null && pending.pausedAt > pending.playingAt
      ? pending.pausedAt
      : now;
  const play: AudioDebugPlay = {
    game: pending.game,
    expected: pending.expected,
    startAt: round(pending.startAt, 3),
    tapToPlayingMs: pending.playingAt !== null ? round(pending.playingAt - pending.tapAt) : null,
    mediaPlayed: round(audio.currentTime - pending.startAt, 3),
    wallPlayed: pending.playingAt !== null ? round((stoppedAt - pending.playingAt) / 1000, 3) : null,
  };
  emit({ ...state, plays: [play, ...state.plays].slice(0, MAX_PLAYS) });
}

/** Resumen en texto plano, para copiarlo y pegarlo en un issue o un chat. */
export function formatAudioDebugReport(current: AudioDebugState): string {
  const lines: string[] = [];
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const connection = (nav as (Navigator & { connection?: { effectiveType?: string } }) | null)
    ?.connection?.effectiveType;
  lines.push(`UA: ${nav?.userAgent ?? "?"}`);
  lines.push(`Red: ${connection ?? "?"}`);
  lines.push("", "CARGAS (ms desde que se crea el <audio>)");
  for (const load of current.loads) {
    lines.push(
      `${load.game} · metadata ${load.metadataMs ?? "-"} · loadeddata ${load.loadedDataMs ?? "-"} · canplaythrough ${load.canPlayThroughMs ?? "-"} · errores ${load.errors}`
    );
  }
  lines.push("", "FRAGMENTOS (esperado · toque→sonido · cabezal · reloj)");
  for (const play of current.plays) {
    lines.push(
      `${play.game} · ${play.expected} s desde ${play.startAt} · ${play.tapToPlayingMs ?? "-"} ms · ${play.mediaPlayed ?? "-"} s · ${play.wallPlayed ?? "-"} s`
    );
  }
  lines.push("", "DESCARGAS");
  for (const download of current.downloads) {
    lines.push(
      `${download.name} · ${download.transferKb ?? "?"} KB transferidos · caché ${download.fromCache ?? "?"} · ttfb ${download.ttfbMs ?? "?"} ms · total ${download.durationMs} ms`
    );
  }
  lines.push("", "EVENTOS (más recientes primero)");
  for (const event of current.events) {
    lines.push(`${event.at} ms · ${event.game} · ${event.event} · ${event.detail}`);
  }
  return lines.join("\n");
}
