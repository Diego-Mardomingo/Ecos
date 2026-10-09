import {
  attachAudioDebug,
  audioDebugLog,
  audioDebugPlayRequested,
  audioDebugSoundStarted,
  audioDebugStopped,
} from "@/lib/audio/audioDebug";

/**
 * Motor de reproducción de un fragmento del preview: un `<audio>` sobre el Blob (o la URL directa)
 * que da `audioStore`. Vive fuera del componente porque es una máquina de estados con timers, rAF y
 * eventos del elemento, y en un componente cada callback arrastraba su lista de dependencias.
 * `AudioPlayer` lo crea, le pasa el contexto vigente y refleja sus avisos en estado de React.
 *
 * Lo que importa de su comportamiento (medido en un iPhone real, ver el plan de audio):
 *
 * - **Sin `seek` redundante.** Antes cada play hacía `currentTime = startAt` aunque ya estuviera ahí,
 *   y en iOS eso coincidía con ~400 ms entre el evento `playing` y el primer sonido. Ahora el
 *   cabezal solo se toca si de verdad cambia (más de `SEEK_EPSILON`).
 * - **Nunca se rebobina (con un Blob).** Medido en iPhone: tras parar y rebobinar con
 *   `currentTime = 0`, el siguiente play pagaba ~290 ms de preroll aunque no hubiera `seek` justo
 *   antes, y un elemento recién creado y sin tocar sonaba exacto. Así que cada play sale de un
 *   `<audio>` nuevo: hay uno cargado y sin tocar, el play se hace en él y, al parar, el usado se
 *   tira y su repuesto ocupa el sitio. Como mucho dos elementos vivos (más uno que se está
 *   tirando). Con una URL directa, un elemento nuevo sería otra descarga: ahí se rebobina.
 * - **«Sonando» es que el cabezal avance**, no el evento `playing`. Entre `play()` y el primer
 *   avance el estado es `starting`; el progreso, `onPlayingChange(true)` y el temporizador de
 *   seguridad empiezan ahí.
 * - **El fin del fragmento es por posición** (`currentTime >= maxDuration`), y pasa a «parado» en
 *   el acto: no hay una ventana en que un toque cuente como «parar».
 * - `play()` se llama síncrono dentro del toque (política de gestos de iOS).
 */

/** Diferencia de posición por debajo de la cual no se hace `seek`. */
const SEEK_EPSILON = 0.01;
/** Avance del cabezal desde el play que se da por «ha empezado a sonar». */
const ADVANCE_EPSILON = 0.005;
/** Si `canplaythrough` no llega en este tiempo tras `canplay`, se da el audio por listo. */
const CAN_PLAY_FALLBACK_MS = 1500;
/** Sin ningún avance del cabezal tras `play()` en este tiempo, se abandona el arranque. */
const START_TIMEOUT_MS = 10_000;
/** Un toque en los primeros ms del arranque se ignora: el botón aún no ha cambiado. */
const START_TAP_GRACE_MS = 500;
const FADE_MS = 20;
/** Tras el fin del fragmento, cuánto se deja el progreso al máximo antes de volver a 0. */
const END_HOLD_MS = 120;
/** Cuánto antes del fin se hace la comprobación puntual (ver `scheduleEndCheck`). */
const END_CHECK_LEAD_MS = 15;
/** Margen del temporizador de seguridad sobre lo que queda de fragmento. */
const SAFETY_MARGIN_S = 0.5;

export interface FragmentPlayerContext {
  /** Segundos del fragmento disponible: el audio para al llegar aquí. */
  maxDuration: number;
  /** Título de la sesión multimedia (sale en la pantalla de bloqueo), ya traducido. */
  fragmentTitle: string;
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
}

export interface FragmentPlayerEvents {
  loadedChange: (loaded: boolean) => void;
  /** Entre `play()` y el primer avance del cabezal. */
  startingChange: (starting: boolean) => void;
  /** `true` solo cuando el cabezal avanza de verdad. */
  playingChange: (playing: boolean) => void;
  error: () => void;
}

let volumeWritable: boolean | null = null;

/**
 * iOS no deja cambiar `volume` (lo lee siempre como 1): ahí no hay fundido y se pausa directo. Se
 * detecta una vez escribiendo y leyendo.
 */
function canWriteVolume(): boolean {
  if (volumeWritable === null) {
    const probe = new Audio();
    probe.volume = 0.5;
    volumeWritable = probe.volume === 0.5;
  }
  return volumeWritable;
}

/** Un `<audio>` del reproductor con su estado de carga y sus oyentes. */
interface Slot {
  audio: HTMLAudioElement;
  /** Nadie ha llamado a `play()` en él. Solo un `seekTo` con el audio parado lo ha podido tocar. */
  fresh: boolean;
  ready: boolean;
  canPlayTimer: number | null;
  disposed: boolean;
  detachDebug: () => void;
  removeListeners: () => void;
}

export class FragmentPlayer {
  /**
   * El elemento sobre el que se hace play, seek y se mide. Parado, y con un Blob, es el repuesto
   * (`fresh`): nuevo, cargado y sin tocar. Sonando es el que suena; si al parar el repuesto aún no
   * estaba listo, se queda de respaldo (rebobinado) hasta que lo esté.
   */
  private cur: Slot;
  /** Se carga mientras `cur` suena (o está de respaldo). Solo con una URL `blob:`. */
  private next: Slot | null = null;
  /** Con un Blob cada play sale de un elemento nuevo; con una URL directa se rebobina. */
  private readonly useSpare: boolean;
  private readonly fadeEnabled: boolean;
  private disposed = false;

  private loaded = false;
  private starting = false;
  private playing = false;
  private stalled = false;
  private fading = false;

  /** Segundo desde el que arrancará el siguiente play, fijado por `seekTo` con el audio parado. */
  private pendingStart = 0;
  /** Posición del cabezal en el play: el avance se mide desde aquí. */
  private playBase = 0;
  private stallPos = 0;
  private tapAt = 0;
  /** Para que el rechazo de un `play()` viejo no pare uno posterior. */
  private playToken = 0;
  private mediaSessionSet = false;

  private raf: number | null = null;
  private safetyTimer: number | null = null;
  private endCheckTimer: number | null = null;
  private startTimer: number | null = null;
  private fadeTimer: number | null = null;
  private endTimer: number | null = null;

  constructor(
    private readonly src: string,
    private readonly label: string,
    private readonly getContext: () => FragmentPlayerContext,
    private readonly events: FragmentPlayerEvents
  ) {
    this.fadeEnabled = canWriteVolume();
    this.useSpare = src.startsWith("blob:");
    this.cur = this.createSlot();
  }

  /** El elemento activo: el que suena o sonará. */
  private get audio(): HTMLAudioElement {
    return this.cur.audio;
  }

  // -------------------------------------------------------------------------------------------
  // Elementos
  // -------------------------------------------------------------------------------------------

  private createSlot(): Slot {
    const audio = new Audio();
    audio.preload = "auto";
    const slot: Slot = {
      audio,
      fresh: true,
      ready: false,
      canPlayTimer: null,
      disposed: false,
      detachDebug: () => {},
      removeListeners: () => {},
    };
    // Antes de poner `src`, para que el diagnóstico vea `loadstart`.
    slot.detachDebug = attachAudioDebug(audio, this.src, this.label);
    // Lo que no es de carga solo cuenta si viene del activo: un elemento a medias de tirar o el
    // repuesto no deben mover el cabezal, el progreso ni el fin del fragmento.
    const handlers: Array<[string, () => void]> = [
      ["canplay", () => this.onCanPlay(slot)],
      ["canplaythrough", () => this.onCanPlayThrough(slot)],
      ["error", () => this.onError(slot)],
      ["timeupdate", () => this.onTimeupdate(slot)],
      ["waiting", () => this.onWaiting(slot)],
      ["stalled", () => this.onWaiting(slot)],
      ["ended", () => this.onEndedNative(slot)],
    ];
    for (const [name, handler] of handlers) audio.addEventListener(name, handler);
    slot.removeListeners = () => {
      for (const [name, handler] of handlers) audio.removeEventListener(name, handler);
    };
    audio.src = this.src;
    audio.load();
    return slot;
  }

  /** Suelta un elemento por completo: oyentes, diagnóstico y recursos del navegador. */
  private disposeSlot(slot: Slot) {
    if (slot.disposed) return;
    slot.disposed = true;
    if (slot.canPlayTimer !== null) {
      clearTimeout(slot.canPlayTimer);
      slot.canPlayTimer = null;
    }
    slot.removeListeners();
    slot.detachDebug();
    const audio = slot.audio;
    // `removeAttribute` + `load()` y no `src = ""`: eso dispara un `error` y, en WebKit antiguo,
    // hasta una petición a la propia página.
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  /** Crea el repuesto si falta. Se llama cuando el arranque ya no depende de ello. */
  private ensureSpare() {
    if (this.disposed || !this.useSpare || this.next) return;
    this.next = this.createSlot();
  }

  /** El repuesto, ya listo, pasa a ser el activo y el usado se tira sin rebobinarlo. */
  private swapToSpare() {
    const spare = this.next;
    if (!spare || !spare.ready) return;
    const old = this.cur;
    this.cur = spare;
    this.next = null;
    this.disposeSlot(old);
    // Un `seekTo` hecho en el respaldo hay que llevarlo al elemento nuevo (parado, sin más).
    if (this.pendingStart > 0) this.seekElement(this.pendingStart);
  }

  // -------------------------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------------------------

  private setLoaded(loaded: boolean) {
    if (this.loaded === loaded) return;
    this.loaded = loaded;
    this.events.loadedChange(loaded);
  }

  /** Un elemento está listo: el activo habilita el botón; el repuesto, si toca, releva al respaldo. */
  private markReady(slot: Slot) {
    if (slot.disposed || slot.ready) return;
    slot.ready = true;
    if (slot === this.cur) {
      this.setLoaded(true);
      return;
    }
    // Parado y con un respaldo ya usado: se cambia ahora. Durante un fundido lo hará `settleFade`.
    if (slot === this.next && !this.starting && !this.playing && !this.fading && !this.cur.fresh) {
      this.swapToSpare();
    }
  }

  /**
   * «Listo» es `canplaythrough` (el navegador cree que puede llegar al final sin parar: con el MP3
   * ya en memoria llega enseguida). Si Safari no lo dispara para alguna fuente, `canplay` más
   * `CAN_PLAY_FALLBACK_MS` basta, para que el botón no gire para siempre.
   */
  private onCanPlay(slot: Slot) {
    if (slot.disposed || slot.ready || slot.canPlayTimer !== null) return;
    slot.canPlayTimer = window.setTimeout(() => {
      slot.canPlayTimer = null;
      this.markReady(slot);
    }, CAN_PLAY_FALLBACK_MS);
  }

  private onCanPlayThrough(slot: Slot) {
    if (slot.canPlayTimer !== null) {
      clearTimeout(slot.canPlayTimer);
      slot.canPlayTimer = null;
    }
    this.markReady(slot);
  }

  private onError(slot: Slot) {
    if (slot.disposed) return;
    if (slot !== this.cur) {
      // Falla el repuesto: el activo sigue sirviendo (rebobinando) y se pedirá otro en el próximo play.
      if (slot === this.next) this.next = null;
      this.disposeSlot(slot);
      audioDebugLog(this.label, "repuesto", "error de carga, descartado");
      return;
    }
    if (slot.canPlayTimer !== null) {
      clearTimeout(slot.canPlayTimer);
      slot.canPlayTimer = null;
    }
    this.release();
    this.clearMediaSession();
    this.setLoaded(false);
    this.events.startingChange(false);
    this.events.playingChange(false);
    this.events.error();
  }

  // -------------------------------------------------------------------------------------------
  // Controles
  // -------------------------------------------------------------------------------------------

  toggle() {
    if (this.disposed || !this.loaded) return;
    if (this.playing) {
      this.stop();
      return;
    }
    if (this.starting) {
      if (performance.now() - this.tapAt >= START_TAP_GRACE_MS) this.stop();
      return;
    }
    this.settleFade();
    this.play();
  }

  stopIfPlaying() {
    if (this.playing || this.starting) this.stop();
  }

  seekTo(seconds: number) {
    if (this.disposed || !this.loaded) return;
    const ctx = this.getContext();
    // Un pelo antes del final: caer justo en `maxDuration` dispararía el corte de fin de fragmento.
    const clamped = Math.min(Math.max(0, seconds), Math.max(0, ctx.maxDuration - 0.05));
    this.settleFade();
    if (this.playing || this.starting) {
      this.seekElement(clamped);
      if (this.starting) this.playBase = clamped;
      if (this.playing) this.armSafety(clamped);
      this.updateMediaPosition(clamped);
    } else {
      // Parado: se coloca el cabezal ya, con el audio en pausa, para que el play no tenga que
      // hacer `seek` (en iOS ese `seek` justo antes de reproducir retrasa el sonido).
      this.pendingStart = clamped;
      this.seekElement(clamped);
    }
    // Parado también se notifica: así quien pinta la onda deja el cabezal donde se tocó.
    ctx.onTimeUpdate?.(clamped);
  }

  /** `seek` solo si la posición cambia de verdad. */
  private seekElement(seconds: number) {
    if (Math.abs(this.audio.currentTime - seconds) > SEEK_EPSILON) {
      this.audio.currentTime = seconds;
    }
  }

  private play() {
    const audio = this.audio;
    const ctx = this.getContext();
    const startAt = Math.min(this.pendingStart, Math.max(0, ctx.maxDuration - 0.05));
    this.pendingStart = 0;
    audioDebugPlayRequested(audio, startAt, ctx.maxDuration);

    // Elemento nuevo (Blob) o el mismo rebobinado (URL directa, o el repuesto aún no estaba listo).
    const path = !this.useSpare
      ? "URL directa, mismo elemento"
      : this.cur.fresh
        ? "elemento nuevo"
        : "rebobinado (sin repuesto)";
    this.cur.fresh = false;
    audioDebugLog(this.label, "play", path);

    const needsSeek = Math.abs(audio.currentTime - startAt) > SEEK_EPSILON;
    if (needsSeek) audio.currentTime = startAt;
    this.playBase = needsSeek ? startAt : audio.currentTime;
    this.tapAt = performance.now();
    this.stalled = false;
    this.starting = true;
    const token = ++this.playToken;

    // Síncrono dentro del toque. Puede rechazar (autoplay bloqueado, o un stop inmediato): si
    // sigue siendo este play, se vuelve a «parado» en vez de quedarse esperando un sonido.
    void audio.play().catch(() => {
      if (this.disposed || token !== this.playToken || !(this.starting || this.playing)) return;
      this.stop();
    });

    this.events.startingChange(true);
    this.setupMediaSession(ctx.fragmentTitle, startAt);
    this.startTimer = window.setTimeout(() => {
      this.startTimer = null;
      if (this.starting) this.stop();
    }, START_TIMEOUT_MS);
    this.cancelLoop();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Primer avance del cabezal: de aquí en adelante «suena». */
  private markSoundStarted(position: number) {
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.starting = false;
    this.playing = true;
    audioDebugSoundStarted(this.audio);
    this.armSafety(position);
    this.events.startingChange(false);
    this.events.playingChange(true);
    // Ya suena: crear el repuesto ahora no retrasa el arranque.
    this.ensureSpare();
  }

  /** Parada pedida (toque, `stopIfPlaying`, fallo de arranque). No avisa de `onEnded`. */
  private stop() {
    if (!this.starting && !this.playing) return;
    const wasPlaying = this.playing;
    this.release();
    audioDebugStopped(this.audio);
    this.pendingStart = 0;
    this.events.startingChange(false);
    this.events.playingChange(false);
    this.clearMediaSession();
    if (wasPlaying && this.fadeEnabled && !document.hidden) {
      this.fadeOutThenPause();
    } else {
      this.parkActive();
    }
    this.getContext().onTimeUpdate?.(0);
  }

  /** Fin del fragmento: por posición, por `ended` nativo o por el temporizador de seguridad. */
  private finish() {
    if (!this.starting && !this.playing) return;
    this.release();
    audioDebugStopped(this.audio);
    // Corte seco: un fundido aquí alargaría el sonido más allá de `maxDuration`.
    this.parkActive();
    this.events.startingChange(false);
    this.events.playingChange(false);
    this.clearMediaSession();
    const ctx = this.getContext();
    ctx.onTimeUpdate?.(ctx.maxDuration);
    // El progreso se queda lleno un instante antes de volver a 0, pero el estado ya es «parado».
    this.endTimer = window.setTimeout(() => {
      this.endTimer = null;
      if (this.disposed || this.starting || this.playing) return;
      this.getContext().onTimeUpdate?.(0);
    }, END_HOLD_MS);
    ctx.onEnded?.();
  }

  /** Deja el estado interno en «parado» y suelta timers y bucle. */
  private release() {
    this.starting = false;
    this.playing = false;
    this.stalled = false;
    this.cancelLoop();
    this.clearSafety();
    this.clearTimer("startTimer");
    this.clearTimer("endTimer");
  }

  /**
   * Pausa el activo y lo deja listo para el siguiente play. Con un Blob y el repuesto listo, no se
   * rebobina: se tira y el repuesto (nuevo, sin tocar) ocupa su sitio. Si el repuesto aún no está
   * (o es una URL directa), se rebobina a 0, pausado antes, y se pide el repuesto si falta.
   */
  private parkActive() {
    const audio = this.audio;
    audio.pause();
    if (this.useSpare && this.next?.ready) {
      this.swapToSpare();
      return;
    }
    if (this.fadeEnabled) audio.volume = 1;
    if (audio.currentTime > SEEK_EPSILON) audio.currentTime = 0;
    this.ensureSpare();
  }

  private fadeOutThenPause() {
    this.fading = true;
    const audio = this.audio;
    const startedAt = performance.now();
    const step = () => {
      this.fadeTimer = null;
      const progress = (performance.now() - startedAt) / FADE_MS;
      if (progress >= 1) {
        this.settleFade();
        return;
      }
      audio.volume = 1 - progress;
      this.fadeTimer = window.setTimeout(step, 4);
    };
    step();
  }

  /** Termina un fundido a medias (pausa y deja el elemento listo) antes de seguir. */
  private settleFade() {
    if (!this.fading) return;
    this.fading = false;
    this.clearTimer("fadeTimer");
    this.parkActive();
  }

  // -------------------------------------------------------------------------------------------
  // Seguimiento del cabezal
  // -------------------------------------------------------------------------------------------

  /** Un fotograma: detecta el primer avance, el fin del fragmento y publica el progreso. */
  private frame = () => {
    this.raf = null;
    this.tick(true);
    if (this.starting || this.playing) this.raf = requestAnimationFrame(this.frame);
  };

  /** `timeupdate` respalda al rAF cuando el navegador lo ralentiza (pestaña en segundo plano). */
  private onTimeupdate(slot: Slot) {
    if (slot === this.cur) this.tick(false);
  }

  private tick(publish: boolean) {
    if (!this.starting && !this.playing) return;
    const time = this.audio.currentTime;
    if (this.starting) {
      if (time <= this.playBase + ADVANCE_EPSILON) return;
      this.markSoundStarted(time);
    }
    if (this.stalled && time > this.stallPos + ADVANCE_EPSILON) {
      this.stalled = false;
      this.armSafety(time);
    }
    if (time >= this.getContext().maxDuration) {
      this.finish();
      return;
    }
    if (publish) this.getContext().onTimeUpdate?.(time);
  }

  /**
   * Temporizador de seguridad, por si el rAF y `timeupdate` se ralentizan. Se arma con lo que
   * *queda* de fragmento desde `fromSeconds` (tras un salto hacia atrás, contar desde el play
   * cortaría antes de tiempo) y solo cuando el cabezal avanza de verdad: armarlo en `play()`
   * cortaba los fragmentos cortos si el arranque tardaba más del margen.
   */
  private armSafety(fromSeconds: number) {
    this.clearSafety();
    const remaining = Math.max(0, this.getContext().maxDuration - fromSeconds);
    this.safetyTimer = window.setTimeout(() => {
      this.safetyTimer = null;
      this.finish();
    }, (remaining + SAFETY_MARGIN_S) * 1000);
    this.scheduleEndCheck(remaining);
  }

  /**
   * Comprobación puntual del fin, un poco antes de que toque. El rAF y `timeupdate` (cada 250 ms)
   * pueden llegar tarde si el navegador no pinta fotogramas; con esto el corte no depende de ellos.
   * Lee la posición real del cabezal: si aún no ha llegado, se reprograma con lo que falte.
   */
  private scheduleEndCheck(remainingSeconds: number) {
    this.clearTimer("endCheckTimer");
    this.endCheckTimer = window.setTimeout(() => {
      this.endCheckTimer = null;
      if (!this.playing || this.stalled) return;
      const time = this.audio.currentTime;
      const max = this.getContext().maxDuration;
      if (time >= max) this.finish();
      else this.scheduleEndCheck(max - time);
    }, Math.max(4, remainingSeconds * 1000 - END_CHECK_LEAD_MS));
  }

  private clearSafety() {
    this.clearTimer("safetyTimer");
    this.clearTimer("endCheckTimer");
  }

  /** `waiting`/`stalled`: el cabezal se ha parado, así que el temporizador no debe contar. */
  private onWaiting(slot: Slot) {
    if (slot !== this.cur || !this.playing || this.stalled) return;
    this.stalled = true;
    this.stallPos = this.audio.currentTime;
    this.clearSafety();
  }

  private onEndedNative(slot: Slot) {
    if (slot === this.cur) this.finish();
  }

  private cancelLoop() {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  private clearTimer(
    name: "safetyTimer" | "endCheckTimer" | "startTimer" | "fadeTimer" | "endTimer"
  ) {
    const id = this[name];
    if (id !== null) {
      clearTimeout(id);
      this[name] = null;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Sesión multimedia
  // -------------------------------------------------------------------------------------------

  private setupMediaSession(title: string, startAt: number) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      // Sale en la pantalla de bloqueo del móvil, así que va traducido.
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: "", album: "" });
      // playbackState "none" evita que aparezca en los controles del sistema.
      navigator.mediaSession.playbackState = "none";
      this.updateMediaPosition(startAt);
      navigator.mediaSession.setActionHandler("seekto", (details) => this.seekTo(details.seekTime ?? 0));
      this.mediaSessionSet = true;
    } catch {
      // ignore
    }
  }

  /** Solo al empezar y al saltar: a 60 veces por segundo era trabajo gratis para el navegador. */
  private updateMediaPosition(position: number) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const duration = this.getContext().maxDuration;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(position, duration),
      });
    } catch {
      // ignore
    }
  }

  private clearMediaSession() {
    if (!this.mediaSessionSet) return;
    this.mediaSessionSet = false;
    try {
      navigator.mediaSession.setPositionState();
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      navigator.mediaSession.setActionHandler("seekto", null);
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------------------------------------------------
  // Limpieza
  // -------------------------------------------------------------------------------------------

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.starting = false;
    this.playing = false;
    this.fading = false;
    this.cancelLoop();
    this.clearSafety();
    this.clearTimer("startTimer");
    this.clearTimer("fadeTimer");
    this.clearTimer("endTimer");
    this.disposeSlot(this.cur);
    if (this.next) this.disposeSlot(this.next);
    this.next = null;
    this.clearMediaSession();
  }
}
