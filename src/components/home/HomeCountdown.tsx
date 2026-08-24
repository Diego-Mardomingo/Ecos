"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getMsUntilNextMidnightMadrid } from "@/lib/date-utils";

/**
 * Cuenta atrás hasta la próxima medianoche de Madrid, con el carrusel vertical de dígitos.
 * Extraído de `HomeClient` sin cambios de lógica.
 */
function getCountdownParts(ms: number): { value: number; suffix: "h" | "m" | "s" }[] {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: { value: number; suffix: "h" | "m" | "s" }[] = [];
  if (h > 0) parts.push({ value: h, suffix: "h" });
  if (m > 0 || h > 0) parts.push({ value: m, suffix: "m" });
  parts.push({ value: s, suffix: "s" });
  return parts;
}

/** Carrusel vertical: al bajar el valor, el nuevo número entra desde abajo; al subir (p. ej. 0→59), desde arriba. */
function RollingCountdownSegment({
  value,
  suffix,
}: {
  value: number;
  suffix: "h" | "m" | "s";
}) {
  // Dirección de la animación guardada junto al valor que la produjo. En estado, no
  // en una ref: leer una ref durante el render impide al compilador de React saber
  // cuándo cambia el valor. Se guardan juntos para que el render extra que dispara
  // el ajuste no invierta la dirección.
  const [prev, setPrev] = useState({ value, downward: true });
  if (prev.value !== value) {
    setPrev({ value, downward: value < prev.value });
  }
  const downward = prev.value === value ? prev.downward : value < prev.value;

  return (
    <span className="inline-flex shrink-0 items-baseline tabular-nums">
      <span className="relative inline-block w-[2ch] shrink-0 overflow-hidden text-end">
        <span className="invisible block select-none tabular-nums" aria-hidden>
          {value}
        </span>
        <AnimatePresence initial={false}>
          <motion.span
            key={value}
            initial={{ y: downward ? "100%" : "-100%" }}
            animate={{ y: 0 }}
            exit={{ y: downward ? "-100%" : "100%" }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 flex items-end justify-end tabular-nums"
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      <span>{suffix}</span>
    </span>
  );
}

const MS_PER_HOUR = 3600 * 1000;
const PREFETCH_UNDER_MS = 10_000;

function Countdown({
  t,
  onCountdownUnder10s,
  onCountdownZero,
}: {
  t: (key: string) => string;
  onCountdownUnder10s?: () => void;
  onCountdownZero?: () => void;
}) {
  // ms = 0 significa "todavía sin medir": es lo que se renderiza en servidor y al
  // hidratar, así que no hace falta un flag `mounted` aparte.
  const [ms, setMs] = useState(0);
  const prevMsRef = useRef<number | null>(null);
  const hasTriggeredRef = useRef(false);
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
    if (
      onCountdownUnder10s &&
      ms < PREFETCH_UNDER_MS &&
      !hasTriggeredUnder10Ref.current
    ) {
      hasTriggeredUnder10Ref.current = true;
      onCountdownUnder10s();
    }
  }, [ms, onCountdownUnder10s]);

  useEffect(() => {
    if (ms <= 0 || !onCountdownZero || hasTriggeredRef.current) return;
    const prev = prevMsRef.current;
    prevMsRef.current = ms;
    if (prev !== null && prev < 60000 && ms > MS_PER_HOUR) {
      hasTriggeredRef.current = true;
      onCountdownZero();
    }
  }, [ms, onCountdownZero]);

  const parts = ms > 0 ? getCountdownParts(ms) : null;

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1 text-xs font-medium tabular-nums">
      <span className="shrink-0 text-muted-foreground">{t("nextSongIn")}</span>
      {parts ? (
        <span className="inline-flex shrink-0 items-baseline gap-1 text-primary">
          {parts.map((p) => (
            <RollingCountdownSegment
              key={p.suffix}
              value={p.value}
              suffix={p.suffix}
            />
          ))}
        </span>
      ) : (
        <span className="text-primary">—</span>
      )}
    </span>
  );
}

export { Countdown, getCountdownParts };
