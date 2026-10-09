"use client";

import { memo, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import { m } from "framer-motion";
import { ATTEMPT_DURATIONS } from "@/lib/store/gameStore";
import { cn } from "@/lib/utils";
import {
  ATTEMPT_KIND_STYLES,
  attemptKind,
  type AttemptOutcome,
} from "@/components/game/attemptOutcome";

/**
 * Onda segmentada: la línea de tiempo del fragmento partida en los seis tramos de intento
 * (0–1 s, 1–2 s, 2–4 s, 4–8 s, 8–16 s, 16–30 s).
 *
 * Reúne en una sola pieza lo que antes eran tres: el anillo de progreso, la franja de intentos y
 * el contador. Los tramos aún bloqueados se ven aplanados; al desbloquear uno, sus barras se
 * levantan en cascada. Mientras suena, la parte reproducida se rellena en color de marca.
 *
 * Ancho de cada tramo: proporcional a la raíz de la duración del intento, como la antigua franja.
 * Con escala lineal el primer segundo sería un 3 % del ancho, casi invisible junto a los 14 s del
 * último tramo.
 *
 * El progreso **no** pasa por React: el padre llama a `setTime` desde `onTimeUpdate`, que llega en
 * cada fotograma, y aquí se escribe directamente en el DOM. Cada fotograma cuesta lo mínimo:
 * - La geometría de los tramos se mide una vez (y al cambiar el ancho, con `ResizeObserver`), no
 *   en cada fotograma: leer `offsetLeft` tras escribir estilos fuerza a recalcular el layout.
 * - Un solo relleno para todos los tramos, que avanza con `transform` (compositor, sin repintar):
 *   una capa `overflow-hidden` que se desplaza hacia la derecha y, dentro, el relleno que se
 *   desplaza lo mismo hacia la izquierda, así que solo se ve lo que queda a la izquierda del
 *   cabezal. Es el mismo recorte que antes hacía el `clip-path` de seis capas, que se repintaba
 *   entero en cada fotograma.
 * Por eso el relleno no lleva `filter` (un resplandor con `drop-shadow`, por ejemplo): obligaría a
 * recalcular el filtro en cada fotograma de la reproducción.
 */

export type SegmentedWaveformHandle = {
  /** Segundos reproducidos del fragmento. */
  setTime: (seconds: number) => void;
};

const SEGMENT_WEIGHTS = ATTEMPT_DURATIONS.map((s) => Math.sqrt(s));
const TOTAL_WEIGHT = SEGMENT_WEIGHTS.reduce((a, b) => a + b, 0);
/** Barras totales repartidas entre los tramos según su peso. */
const TOTAL_BARS = 60;

/** PRNG pequeño y determinista: la misma partida dibuja siempre la misma onda (y igual en SSR). */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Bar = { height: number; duration: number; delay: number };

/** Posición de cada tramo dentro de la onda, en px. Se mide una vez y al cambiar el ancho. */
type SegmentGeometry = { left: number; width: number }[];

/** X (en px, dentro de la onda) del cabezal para ese segundo: va en el tramo que lo contiene. */
function playheadXAt(seconds: number, geometry: SegmentGeometry): number {
  let start = 0;
  for (let i = 0; i < ATTEMPT_DURATIONS.length; i++) {
    const end = ATTEMPT_DURATIONS[i];
    if (seconds <= end) {
      const ratio = Math.min(1, Math.max(0, (seconds - start) / (end - start)));
      return geometry[i].left + ratio * geometry[i].width;
    }
    start = end;
  }
  const last = geometry[geometry.length - 1];
  return last.left + last.width;
}

/** Lo que `paintProgress` recuerda entre fotogramas para no escribir dos veces lo mismo. */
interface PaintState {
  /** `null` hasta la primera medida. */
  geometry: SegmentGeometry | null;
  seconds: number;
  x: number;
  visible: boolean | null;
}

/** Escribe el progreso en el DOM: solo escrituras, ninguna lectura de layout. */
function paintProgress(
  state: PaintState,
  els: { clip: HTMLElement | null; fill: HTMLElement | null; head: HTMLElement | null },
  seconds: number
) {
  state.seconds = seconds;
  if (!state.geometry) return; // Aún sin medir: la medida lo vuelve a aplicar.
  const x = playheadXAt(seconds, state.geometry);
  if (x !== state.x) {
    state.x = x;
    if (els.clip) els.clip.style.transform = `translateX(calc(-100% + ${x}px))`;
    if (els.fill) els.fill.style.transform = `translateX(calc(100% - ${x}px))`;
    if (els.head) els.head.style.transform = `translateX(${x}px)`;
  }
  const visible = seconds > 0.05;
  if (visible !== state.visible) {
    state.visible = visible;
    if (els.head) els.head.style.opacity = visible ? "1" : "0";
  }
}

/** Alturas con algo de continuidad entre vecinas, para que parezca audio y no ruido. */
function buildSegments(seed: string): Bar[][] {
  const rand = mulberry32(hashString(seed));
  const raw = Array.from({ length: TOTAL_BARS }, () => rand());
  const smooth = raw.map((v, i) => {
    const prev = raw[i - 1] ?? v;
    const next = raw[i + 1] ?? v;
    return (prev + v * 2 + next) / 4;
  });

  const counts = SEGMENT_WEIGHTS.map((w) => Math.max(3, Math.round((w / TOTAL_WEIGHT) * TOTAL_BARS)));
  const segments: Bar[][] = [];
  let cursor = 0;
  for (const count of counts) {
    const bars: Bar[] = [];
    for (let j = 0; j < count; j++) {
      const v = smooth[(cursor + j) % TOTAL_BARS];
      bars.push({
        height: 0.22 + v * 0.78,
        duration: 0.45 + rand() * 0.5,
        delay: -rand() * 0.8,
      });
    }
    cursor += count;
    segments.push(bars);
  }
  return segments;
}

const SegmentedWaveform = memo(function SegmentedWaveform({
  seed,
  unlockedCount,
  guesses,
  currentAttempt = null,
  correctAttempt = null,
  playing,
  compact = false,
  showLabels = true,
  onSeek,
  seekLabel,
  valueSeconds = 0,
  ref,
  className,
}: {
  seed: string;
  /** Tramos audibles (1–6). */
  unlockedCount: number;
  guesses: AttemptOutcome[];
  /** Intento en curso (1-based). `null` en el resultado. */
  currentAttempt?: number | null;
  /** Respaldo para el resultado cuando no llegan los intentos uno a uno. */
  correctAttempt?: number | null;
  playing: boolean;
  compact?: boolean;
  showLabels?: boolean;
  /**
   * Tocar o arrastrar sobre la onda lleva el cabezal a ese segundo (nunca reproduce ni para).
   * Se acota a los tramos desbloqueados. Sin él, la onda es solo visual.
   */
  onSeek?: (seconds: number) => void;
  /** Nombre accesible del deslizador. */
  seekLabel?: string;
  /** Segundo actual (entero), para `aria-valuenow` y para mover con las flechas. */
  valueSeconds?: number;
  ref?: Ref<SegmentedWaveformHandle>;
  className?: string;
}) {
  const segments = useMemo(() => buildSegments(seed), [seed]);
  const trackRef = useRef<HTMLDivElement | null>(null);
  /** Capa que recorta (se desplaza a la derecha) y relleno de dentro (se desplaza a la izquierda). */
  const fillClipRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const paintRef = useRef<PaintState>({ geometry: null, seconds: 0, x: Number.NaN, visible: null });
  /** Arrastre en curso y último x pendiente de aplicar (se aplica una vez por fotograma). */
  const dragRef = useRef<{ active: boolean; pendingX: number | null; raf: number | null }>({
    active: false,
    pendingX: null,
    raf: null,
  });
  const maxSeconds =
    ATTEMPT_DURATIONS[Math.max(0, Math.min(unlockedCount, ATTEMPT_DURATIONS.length) - 1)];

  useImperativeHandle(
    ref,
    () => ({
      setTime: (seconds: number) =>
        paintProgress(
          paintRef.current,
          { clip: fillClipRef.current, fill: fillRef.current, head: playheadRef.current },
          seconds
        ),
    }),
    []
  );

  // Mide dónde cae cada tramo, una vez y cada vez que cambia el ancho de la onda (los pesos son
  // proporciones, así que el alto o el desbloqueo no los mueven). `ResizeObserver` avisa también al
  // empezar a observar, antes del primer pintado.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const state = paintRef.current;
      state.geometry = segmentRefs.current.map((el) => ({
        left: el?.offsetLeft ?? 0,
        width: el?.offsetWidth ?? 0,
      }));
      state.x = Number.NaN;
      paintProgress(
        state,
        { clip: fillClipRef.current, fill: fillRef.current, head: playheadRef.current },
        state.seconds
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  /** Segundo que corresponde a una x de pantalla, recorriendo los tramos (con sus huecos). */
  const secondsAtClientX = (clientX: number): number => {
    let start = 0;
    for (let i = 0; i < ATTEMPT_DURATIONS.length; i++) {
      const end = ATTEMPT_DURATIONS[i];
      const seg = segmentRefs.current[i];
      if (seg) {
        const rect = seg.getBoundingClientRect();
        // Antes del tramo (o en el hueco que lo precede): su inicio.
        if (clientX < rect.left) return start;
        if (clientX <= rect.right) {
          return start + ((clientX - rect.left) / rect.width) * (end - start);
        }
      }
      start = end;
    }
    return start;
  };

  const seekToClientX = (clientX: number) => {
    if (!onSeek) return;
    onSeek(Math.min(maxSeconds, Math.max(0, secondsAtClientX(clientX))));
  };

  const flushDrag = () => {
    const drag = dragRef.current;
    drag.raf = null;
    if (drag.pendingX !== null) {
      seekToClientX(drag.pendingX);
      drag.pendingX = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current.active = true;
    playheadRef.current?.setAttribute("data-dragging", "");
    seekToClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    // Un salto del audio por fotograma como mucho: buscar en cada pointermove atasca el móvil.
    drag.pendingX = e.clientX;
    if (drag.raf === null) drag.raf = requestAnimationFrame(flushDrag);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    if (drag.raf !== null) cancelAnimationFrame(drag.raf);
    flushDrag();
    playheadRef.current?.removeAttribute("data-dragging");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const forward = e.key === "ArrowRight" || e.key === "ArrowUp";
    const backward = e.key === "ArrowLeft" || e.key === "ArrowDown";
    if (forward || backward) {
      e.preventDefault();
      onSeek(Math.min(maxSeconds, Math.max(0, valueSeconds + (forward ? 1 : -1))));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    }
  };

  const sliderProps = onSeek
    ? {
        role: "slider" as const,
        tabIndex: 0,
        "aria-label": seekLabel,
        "aria-valuemin": 0,
        "aria-valuemax": maxSeconds,
        "aria-valuenow": Math.min(valueSeconds, maxSeconds),
        "aria-valuetext": `${Math.min(valueSeconds, maxSeconds)} s / ${maxSeconds} s`,
      }
    : { "aria-hidden": true };

  return (
    <div className={cn("w-full", className)}>
      <div
        ref={trackRef}
        className={cn(
          "relative flex w-full select-none gap-1.5 rounded-lg transition-[height] duration-[250ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card",
          compact ? "h-10" : "h-[72px]",
          onSeek && "cursor-pointer"
        )}
        // pan-y: el arrastre horizontal es para buscar; el vertical sigue desplazando la página.
        style={onSeek ? { touchAction: "pan-y" } : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        {...sliderProps}
      >
        {/* Cabezal: lo coloca `setTime`. Invisible en el segundo 0. */}
        <div
          ref={playheadRef}
          aria-hidden
          className="group/head pointer-events-none absolute -inset-y-1.5 left-0 z-10 w-0 opacity-0 transition-opacity duration-200 will-change-transform"
        >
          <span className="absolute inset-y-0 -left-px w-0.5 rounded-full bg-brand shadow-[0_0_8px_var(--brand)]" />
          <span className="absolute -left-[5px] -top-1 size-2.5 rounded-full border-2 border-card bg-brand transition-transform duration-150 group-data-[dragging]/head:scale-150" />
        </div>
        {segments.map((bars, i) => {
          const unlocked = i < unlockedCount;
          const wobble = playing && unlocked;
          return (
            <div
              key={i}
              ref={(el) => {
                segmentRefs.current[i] = el;
              }}
              aria-hidden
              className="relative"
              style={{ flex: `${SEGMENT_WEIGHTS[i]} 1 0` }}
            >
              {/* Capa base: bloqueado (aplanado) o desbloqueado. */}
              <div className="absolute inset-0 flex items-center gap-[2px]">
                {bars.map((bar, j) => (
                  <BarShape
                    key={j}
                    bar={bar}
                    unlocked={unlocked}
                    wobble={wobble}
                    // Cascada de izquierda a derecha al desbloquear el tramo.
                    delayMs={j * 22}
                    className={unlocked ? "bg-foreground/30" : "bg-foreground/10"}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {/* Relleno: lo ya reproducido, en una sola capa para todos los tramos. Reproduce la misma
            rejilla (mismos pesos y hueco) y la mueve `setTime` con dos `transform`: la capa
            exterior se desplaza hasta el cabezal y el relleno de dentro, lo mismo al revés. */}
        <div
          ref={fillClipRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden will-change-transform"
          style={{ transform: "translateX(-100%)" }}
        >
          <div
            ref={fillRef}
            className="absolute inset-0 flex gap-1.5 will-change-transform"
            style={{ transform: "translateX(100%)" }}
          >
            {segments.map((bars, i) => {
              const unlocked = i < unlockedCount;
              const wobble = playing && unlocked;
              return (
                <div key={i} className="relative" style={{ flex: `${SEGMENT_WEIGHTS[i]} 1 0` }}>
                  <div className="absolute inset-0 flex items-center gap-[2px]">
                    {bars.map((bar, j) => (
                      <BarShape key={j} bar={bar} unlocked={unlocked} wobble={wobble} delayMs={0} className="bg-brand" />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showLabels && (
        <div className="mt-2.5 flex w-full gap-1.5" aria-hidden>
          {ATTEMPT_DURATIONS.map((seconds, i) => {
            const guess = guesses[i];
            const isCurrent = currentAttempt != null && i === currentAttempt - 1;
            const playedByFallback = !guess && correctAttempt != null && i < correctAttempt;
            const kind = guess
              ? attemptKind(guess)
              : playedByFallback
                ? i === correctAttempt! - 1
                  ? "correct"
                  : "wrong"
                : null;
            return (
              <div key={i} className="flex flex-col items-center gap-1.5" style={{ flex: `${SEGMENT_WEIGHTS[i]} 1 0` }}>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  {kind ? (
                    // Crece desde la izquierda con una transición desde `@starting-style` y no con
                    // framer: así no llega con `scaleX(0)` en el HTML del servidor (PERF-04). Donde
                    // no se soporte, aparece ya lleno.
                    <span
                      key={kind}
                      className={cn(
                        "absolute inset-0 origin-left rounded-full transition-[scale] duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] starting:scale-x-0",
                        ATTEMPT_KIND_STYLES[kind].solid
                      )}
                    />
                  ) : isCurrent ? (
                    <m.span
                      layoutId={`${seed}-current-attempt`}
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      className="absolute inset-0 rounded-full bg-brand/70 shadow-[0_0_10px_var(--brand)]"
                    />
                  ) : null}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-semibold leading-none tabular-nums transition-colors",
                    isCurrent ? "text-brand" : kind ? "text-muted-foreground" : "text-muted-foreground/50"
                  )}
                >
                  {seconds}s
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

function BarShape({
  bar,
  unlocked,
  wobble,
  delayMs,
  className,
}: {
  bar: Bar;
  unlocked: boolean;
  wobble: boolean;
  delayMs: number;
  className: string;
}) {
  return (
    <span className="flex h-full min-w-0 flex-1 items-center">
      <span
        className="w-full rounded-full transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{
          height: `${bar.height * 100}%`,
          transform: `scaleY(${unlocked ? 1 : 0.18})`,
          transitionDelay: unlocked ? `${delayMs}ms` : "0ms",
        }}
      >
        <span
          className={cn("block size-full rounded-full transition-colors duration-500", className, wobble && "ecos-wobble")}
          style={
            wobble
              ? ({ "--eq-duration": `${bar.duration}s`, "--eq-delay": `${bar.delay}s` } as React.CSSProperties)
              : undefined
          }
        />
      </span>
    </span>
  );
}

export { SegmentedWaveform };
