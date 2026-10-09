import {
  attachAudioDebug,
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
 *   cabezal se deja en su sitio al parar (pausando antes de rebobinar) y solo se toca si de verdad
 *   cambia (más de `SEEK_EPSILON`).
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

export class FragmentPlayer {
  private readonly audio: HTMLAudioElement;
  private readonly detachDebug: () => void;
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
  private canPlayTimer: number | null = null;
  private fadeTimer: number | null = null;
  private endTimer: number | null = null;

  constructor(
    src: string,
    label: string,
    private readonly getContext: () => FragmentPlayerContext,
    private readonly events: FragmentPlayerEvents
  ) {
    const audio = new Audio();
    this.audio = audio;
    this.fadeEnabled = canWriteVolume();
    audio.preload = "auto";
    // Antes de poner `src`, para que el diagnóstico vea `loadstart`.
    this.detachDebug = attachAudioDebug(audio, src, label);
    audio.addEventListener("canplay", this.onCanPlay);
    audio.addEventListener("canplaythrough", this.onCanPlayThrough);
    audio.addEventListener("error", this.onError);
    audio.addEventListener("timeupdate", this.onTimeupdate);
    audio.addEventListener("waiting", this.onWaiting);
    audio.addEventListener("stalled", this.onWaiting);
    audio.addEventListener("ended", this.onEndedNative);
    audio.src = src;
    audio.load();
  }

  // -------------------------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------------------------

  private setLoaded(loaded: boolean) {
    if (this.loaded === loaded) return;
    this.loaded = loaded;
    this.events.loadedChange(loaded);
  }

  /**
   * «Listo» es `canplaythrough` (el navegador cree que puede llegar al final sin parar: con el MP3
   * ya en memoria llega enseguida). Si Safari no lo dispara para alguna fuente, `canplay` más
   * `CAN_PLAY_FALLBACK_MS` basta, para que el botón no gire para siempre.
   */
  private onCanPlay = () => {
    if (this.loaded || this.canPlayTimer !== null) return;
    this.canPlayTimer = window.setTimeout(() => {
      this.canPlayTimer = null;
      this.setLoaded(true);
    }, CAN_PLAY_FALLBACK_MS);
  };

  private onCanPlayThrough = () => {
    if (this.canPlayTimer !== null) {
      clearTimeout(this.canPlayTimer);
      this.canPlayTimer = null;
    }
    this.setLoaded(true);
  };

  private onError = () => {
    if (this.canPlayTimer !== null) {
      clearTimeout(this.canPlayTimer);
      this.canPlayTimer = null;
    }
    this.release();
    this.clearMediaSession();
    this.setLoaded(false);
    this.events.startingChange(false);
    this.events.playingChange(false);
    this.events.error();
  };

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
      this.pauseAndRewind();
    }
    this.getContext().onTimeUpdate?.(0);
  }

  /** Fin del fragmento: por posición, por `ended` nativo o por el temporizador de seguridad. */
  private finish() {
    if (!this.starting && !this.playing) return;
    this.release();
    audioDebugStopped(this.audio);
    // Corte seco: un fundido aquí alargaría el sonido más allá de `maxDuration`.
    this.pauseAndRewind();
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

  /** Pausa y, solo después, rebobina a 0: así el siguiente play arranca sin `seek`. */
  private pauseAndRewind() {
    const audio = this.audio;
    audio.pause();
    if (this.fadeEnabled) audio.volume = 1;
    if (audio.currentTime > SEEK_EPSILON) audio.currentTime = 0;
  }

  private fadeOutThenPause() {
    this.fading = true;
    const startedAt = performance.now();
    const step = () => {
      this.fadeTimer = null;
      const progress = (performance.now() - startedAt) / FADE_MS;
      if (progress >= 1) {
        this.settleFade();
        return;
      }
      this.audio.volume = 1 - progress;
      this.fadeTimer = window.setTimeout(step, 4);
    };
    step();
  }

  /** Termina un fundido a medias (pausa, rebobina y restaura el volumen) antes de seguir. */
  private settleFade() {
    if (!this.fading) return;
    this.fading = false;
    this.clearTimer("fadeTimer");
    this.pauseAndRewind();
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
  private onTimeupdate = () => this.tick(false);

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
  private onWaiting = () => {
    if (!this.playing || this.stalled) return;
    this.stalled = true;
    this.stallPos = this.audio.currentTime;
    this.clearSafety();
  };

  private onEndedNative = () => this.finish();

  private cancelLoop() {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  private clearTimer(
    name: "safetyTimer" | "endCheckTimer" | "startTimer" | "canPlayTimer" | "fadeTimer" | "endTimer"
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
    this.clearTimer("canPlayTimer");
    this.clearTimer("fadeTimer");
    this.clearTimer("endTimer");
    const audio = this.audio;
    audio.removeEventListener("canplay", this.onCanPlay);
    audio.removeEventListener("canplaythrough", this.onCanPlayThrough);
    audio.removeEventListener("error", this.onError);
    audio.removeEventListener("timeupdate", this.onTimeupdate);
    audio.removeEventListener("waiting", this.onWaiting);
    audio.removeEventListener("stalled", this.onWaiting);
    audio.removeEventListener("ended", this.onEndedNative);
    this.detachDebug();
    // `removeAttribute` + `load()` y no `src = ""`: eso dispara un `error` y, en WebKit antiguo,
    // hasta una petición a la propia página.
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    this.clearMediaSession();
  }
}
