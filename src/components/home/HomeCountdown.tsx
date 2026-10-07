"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getMsUntilNextMidnightMadrid } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

/**
 * Cuenta atrás hasta la próxima medianoche de Madrid: el hook que la mide y el reloj (hh:mm:ss)
 * con dígitos que ruedan por separado.
 */

/**
 * Un dígito del reloj, con carrusel vertical: al bajar el valor, el nuevo entra desde abajo; al
 * subir (p. ej. 0→5 al pasar de 00 a 59), desde arriba. Va por dígito y no por número para que
 * solo se mueva la cifra que cambia, como en un marcador mecánico.
 */
function RollingDigit({ digit }: { digit: number }) {
  // Dirección de la animación guardada junto al valor que la produjo. En estado, no
  // en una ref: leer una ref durante el render impide al compilador de React saber
  // cuándo cambia el valor. Se guardan juntos para que el render extra que dispara
  // el ajuste no invierta la dirección.
  const [prev, setPrev] = useState({ value: digit, downward: true });
  if (prev.value !== digit) {
    setPrev({ value: digit, downward: digit < prev.value });
  }
  const downward = prev.value === digit ? prev.downward : digit < prev.value;

  return (
    <span className="relative inline-block w-[1ch] overflow-hidden text-center tabular-nums">
      <span className="invisible block select-none" aria-hidden>
        0
      </span>
      <AnimatePresence initial={false}>
        <motion.span
          key={digit}
          initial={{ y: downward ? "100%" : "-100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: downward ? "-100%" : "100%", opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Dos dígitos rodantes. */
function RollingCountdownSegment({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(99, value));
  return (
    <span className="inline-flex">
      <RollingDigit digit={Math.floor(clamped / 10)} />
      <RollingDigit digit={clamped % 10} />
    </span>
  );
}

const MS_PER_HOUR = 3600 * 1000;
const PREFETCH_UNDER_MS = 10_000;

/**
 * Milisegundos hasta la próxima medianoche de Madrid, refrescados cada segundo, y los dos avisos
 * de la home: a menos de 10 s (para precargar el día siguiente) y al pasar la medianoche.
 *
 * El aviso de medianoche solo salta si la cuenta atrás la ve pasar (app delante). Con la app en
 * segundo plano los temporizadores se congelan y no la ve: de ese caso se encarga la home
 * comparando fechas al volver a primer plano (`syncGameDay` en `HomeClient`). Los dos avisos se
 * rearman cada día, así que una pestaña abierta varias noches los recibe todas.
 *
 * `0` significa «todavía sin medir»: es lo que se renderiza en servidor y al hidratar, así que no
 * hace falta un flag `mounted` aparte.
 */
function useMadridCountdown({
  onUnder10s,
  onZero,
}: {
  onUnder10s?: () => void;
  onZero?: () => void;
} = {}): number {
  const [ms, setMs] = useState(0);
  const prevMsRef = useRef<number | null>(null);
  const hasTriggeredUnder10Ref = useRef(false);

  useEffect(() => {
    const tick = () => setMs(getMsUntilNextMidnightMadrid());
    // La primera medición va en un rAF y no en el cuerpo del efecto, para no
    // encadenar un render síncrono nada más montar.
    const raf = requestAnimationFrame(tick);
    const id = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (ms <= 0) return;
    if (ms > MS_PER_HOUR) hasTriggeredUnder10Ref.current = false;
    if (onUnder10s && ms < PREFETCH_UNDER_MS && !hasTriggeredUnder10Ref.current) {
      hasTriggeredUnder10Ref.current = true;
      onUnder10s();
    }
  }, [ms, onUnder10s]);

  useEffect(() => {
    if (ms <= 0 || !onZero) return;
    const prev = prevMsRef.current;
    prevMsRef.current = ms;
    if (prev !== null && prev < 60000 && ms > MS_PER_HOUR) {
      onZero();
    }
  }, [ms, onZero]);

  return ms;
}

/**
 * Reloj hh:mm:ss con dígitos rodantes. Hereda tipografía y color del padre; el lector de pantalla
 * recibe la hora entera, no cada dígito suelto.
 */
function ClockDigits({ ms, className }: { ms: number; className?: string }) {
  const totalSec = Math.floor(ms / 1000);
  const hms =
    ms > 0 ? [Math.floor(totalSec / 3600), Math.floor((totalSec % 3600) / 60), totalSec % 60] : null;

  return (
    <span
      className={cn("inline-flex items-center tabular-nums", className)}
      aria-label={hms ? hms.map((n) => String(n).padStart(2, "0")).join(":") : undefined}
    >
      {hms ? (
        <span className="inline-flex items-center" aria-hidden>
          {hms.map((value, i) => (
            <span key={i} className="inline-flex items-center">
              {i > 0 && <span className="opacity-60">:</span>}
              <RollingCountdownSegment value={value} />
            </span>
          ))}
        </span>
      ) : (
        <span className="opacity-50">--:--:--</span>
      )}
    </span>
  );
}

/** Píldora «Próxima canción en hh:mm:ss» bajo la tarjeta del reto. */
function Countdown({
  t,
  onCountdownUnder10s,
  onCountdownZero,
  className,
}: {
  t: (key: string) => string;
  onCountdownUnder10s?: () => void;
  onCountdownZero?: () => void;
  className?: string;
}) {
  const ms = useMadridCountdown({ onUnder10s: onCountdownUnder10s, onZero: onCountdownZero });
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs font-medium", className)}>
      <span className="text-muted-foreground">{t("nextSongIn")}</span>
      <span className="inline-flex items-center rounded-full border border-border bg-card/80 px-2.5 py-1 font-semibold text-foreground shadow-sm backdrop-blur">
        <span className="mr-1.5 size-1.5 animate-pulse rounded-full bg-brand" style={{ animationDuration: "2s" }} aria-hidden />
        <ClockDigits ms={ms} />
      </span>
    </span>
  );
}

export { Countdown };
