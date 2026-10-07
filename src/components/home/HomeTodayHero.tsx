"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { getEffectiveGameDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { attemptFromScore } from "@/lib/scoring";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { titleCaseWords } from "@/components/home/homeHelpers";
import {
  ATTEMPT_KIND_STYLES,
  attemptKind,
  type AttemptKind,
  type AttemptOutcome,
} from "@/components/game/attemptOutcome";

/**
 * Tarjeta del reto de hoy: la pieza principal de la home.
 *
 * Es un LP: una funda cuadrada y el vinilo asomando por detrás.
 * - **Sin empezar**: la funda es la fecha del reto («5 OCT») sobre verde, con ondas finas y un
 *   rayado holográfico; el disco casi metido en la funda.
 * - **En curso**: el disco sale un poco y gira más rápido; debajo, los intentos gastados.
 * - **Completado**: la funda pasa a ser la carátula real de la canción, el disco sale con los
 *   puntos encima y una pegatina dice el resultado. Si se falló, el disco se para.
 *
 * Las medidas de la funda y el disco cuelgan de `--s` (lado de la funda), que se ajusta al ancho
 * de la tarjeta con unidades de contenedor para que el conjunto no se desborde en móviles estrechos.
 */

const MAX_ATTEMPTS = 6;

/**
 * Entradas en CSS y no en framer-motion: con framer, el HTML del servidor llegaba con
 * `opacity:0` y la tarjeta (el LCP de la home) no se veía hasta hidratar (PERF-04). La animación
 * CSS corre desde el primer pintado, sin esperar al JS. `prefers-reduced-motion` la anula desde
 * `globals.css`.
 */
const ENTER =
  "animate-in fade-in slide-in-from-bottom-4 zoom-in-98 animation-duration-550 [--tw-ease:cubic-bezier(0.22,1,0.36,1)]";
/** Cada bloque de la tarjeta sube un poco después del anterior (el antiguo `staggerChildren`). */
const RISE =
  "animate-in fade-in slide-in-from-bottom-[10px] animation-duration-450 [--tw-ease:cubic-bezier(0.22,1,0.36,1)] fill-mode-backwards";
const riseDelay = (step: number) => ({ animationDelay: `${50 + step * 60}ms` });

/**
 * Ondas de la funda: senoides finas en diagonal. Se calculan una vez al cargar el módulo y se
 * redondean a un decimal, así servidor y cliente generan el mismo SVG.
 */
const SLEEVE_WAVES = Array.from({ length: 9 }, (_, k) => {
  const y0 = 20 + k * 24;
  const amp = 5 + (k % 3) * 4;
  const phase = k * 0.9;
  const freq = 0.028 + (k % 4) * 0.004;
  let d = "";
  for (let x = -10; x <= 230; x += 6) {
    const y = y0 + Math.sin(x * freq + phase) * amp + x * 0.12;
    d += `${x === -10 ? "M" : "L"}${x},${y.toFixed(1)}`;
  }
  return d;
});

/**
 * Tramos de la franja de intentos. Si la partida terminada no trae los intentos (resultado del
 * servidor sin progreso local), se reconstruyen a partir del intento del acierto.
 */
function attemptSlots(guesses: AttemptOutcome[], completed: boolean, won: boolean, wonAttempt: number | null) {
  const kinds: (AttemptKind | null)[] = guesses.map(attemptKind);
  if (completed && kinds.length === 0) {
    if (won && wonAttempt) {
      for (let i = 1; i < wonAttempt; i++) kinds.push("wrong");
      kinds.push("correct");
    } else if (!won) {
      for (let i = 0; i < MAX_ATTEMPTS; i++) kinds.push("wrong");
    }
  }
  while (kinds.length < MAX_ATTEMPTS) kinds.push(null);
  return kinds.slice(0, MAX_ATTEMPTS);
}

export function HomeTodayHero({
  gameNumber,
  gameDate,
  completed,
  inProgress,
  won,
  guesses,
  cover,
  title,
  artist,
  score,
  onPlay,
  onPrefetch,
  onShare,
}: {
  gameNumber: number | null;
  gameDate: string | null;
  completed: boolean;
  inProgress: boolean;
  won: boolean;
  guesses: AttemptOutcome[];
  cover: string;
  title: string;
  artist: string;
  score: number | null;
  onPlay: () => void;
  onPrefetch: () => void;
  onShare: (e: React.MouseEvent) => void;
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const { dateFnsLocale, formatNumber } = useAppFormatters();

  // Fecha del reto, no la del navegador: el día de juego va en hora de Madrid.
  const day = parseISO(gameDate ?? getEffectiveGameDate());
  const weekday = format(day, "EEEE", { locale: dateFnsLocale });
  const dayNumber = format(day, "d", { locale: dateFnsLocale });
  const month = format(day, "MMM", { locale: dateFnsLocale }).replace(".", "");
  const year = format(day, "yyyy", { locale: dateFnsLocale });
  const shortDate = `${titleCaseWords(format(day, "EEE", { locale: dateFnsLocale }).replace(".", ""))} · ${dayNumber} ${month}`;

  const correctIndex = guesses.findIndex((g) => g.correct);
  const wonAttempt = won ? (correctIndex >= 0 ? correctIndex + 1 : attemptFromScore(score)) : null;
  const slots = attemptSlots(guesses, completed, won, wonAttempt);
  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - guesses.length);
  const discOut = completed || inProgress;

  const em = (chunks: React.ReactNode) => <em className="not-italic text-brand">{chunks}</em>;

  const sticker = completed
    ? won
      ? { label: t("heroStickerWon", { attempt: wonAttempt ?? guesses.length }), foil: true }
      : { label: t("heroStickerLost"), foil: false }
    : { label: inProgress ? t("heroStickerInProgress") : t("heroStickerToday"), foil: true };

  return (
    <section className={ENTER}>
      {/* Contenedor estático: en iOS Safari, transform (p. ej. whileTap) en el mismo nodo que
          rounded + overflow-hidden rompe el recorte; el motion.div va dentro sin border-radius en
          el padre animado. */}
      <div
        className={cn(
          "relative isolate overflow-hidden rounded-[28px] border border-border bg-card",
          completed && !won
            ? "shadow-[0_20px_50px_-28px_color-mix(in_srgb,var(--destructive)_45%,transparent)]"
            : "shadow-[0_20px_50px_-28px_color-mix(in_srgb,var(--brand)_55%,transparent)]"
        )}
      >
        <motion.div
          whileTap={{ scale: 0.985 }}
          onMouseEnter={onPrefetch}
          onClick={onPlay}
          className="@container relative flex cursor-pointer flex-col gap-4 p-[18px]"
        >
          {/* Funda + disco */}
          <div className={cn(RISE, "relative [--s:min(216px,64cqw)]")} style={riseDelay(0)}>
            {/* Vinilo, detrás de la funda */}
            <div
              className="absolute z-0 transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                width: "calc(var(--s) * 0.954)",
                height: "calc(var(--s) * 0.954)",
                left: "calc(var(--s) * 0.5)",
                top: "calc(var(--s) * 0.023)",
                transform: discOut ? "translateX(calc(var(--s) * 0.185))" : undefined,
              }}
              role={completed ? undefined : "img"}
              aria-label={completed ? undefined : t("heroMysteryLabel")}
              aria-hidden={completed || undefined}
            >
              <div
                className="ecos-vinyl ecos-spin-slow absolute inset-0 rounded-full shadow-[0_14px_30px_-14px_rgba(0,0,0,0.7)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1),0_14px_30px_-14px_rgba(0,0,0,0.9)]"
                style={{
                  animationDuration: inProgress ? "2.4s" : "7s",
                  animationPlayState: completed && !won ? "paused" : undefined,
                }}
              >
                <div
                  className={cn(
                    "absolute inset-[31%] flex items-center justify-center rounded-full",
                    completed && !won ? "bg-zinc-600" : "bg-[conic-gradient(var(--brand),var(--brand-dim),var(--brand))]"
                  )}
                >
                  {/* Rótulo de la galleta: gira con el disco y hace evidente que da vueltas. */}
                  <span
                    className={cn(
                      "absolute top-[16%] font-display text-[length:calc(var(--s)*0.06)] font-extrabold lowercase leading-none tracking-[-0.02em]",
                      completed && !won ? "text-zinc-300" : "text-primary-foreground"
                    )}
                  >
                    ecos
                  </span>
                  <span className="size-2.5 rounded-full bg-card" />
                </div>
              </div>
              {/* Brillo fijo: no gira con el disco, así se lee como reflejo de luz. */}
              <div className="pointer-events-none absolute inset-0 rounded-full bg-[conic-gradient(from_30deg,transparent_0_12%,rgba(255,255,255,0.1)_16%,transparent_22%_62%,rgba(255,255,255,0.07)_66%,transparent_72%)]" />
            </div>

            {/* Funda */}
            <div className="relative z-10 aspect-square w-[var(--s)] overflow-hidden rounded-xl shadow-[10px_0_22px_-10px_rgba(0,0,0,0.4)] ring-1 ring-inset ring-white/10">
              {completed ? (
                <>
                  {cover ? (
                    <Image src={cover} alt={title} fill sizes="216px" className="object-cover" priority />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-brand to-brand-dim" />
                  )}
                  <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_55%,rgba(0,0,0,0.5))]" />
                  <span className="absolute bottom-3 left-3 rounded-md bg-black/35 px-2 py-1 font-mono text-[11px] font-extrabold uppercase tracking-[0.12em] text-white backdrop-blur-md">
                    {shortDate}
                  </span>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col bg-[linear-gradient(150deg,var(--brand),var(--brand-dim))] px-[15px] py-3.5 text-primary-foreground">
                  <svg
                    aria-hidden
                    viewBox="0 0 216 216"
                    preserveAspectRatio="none"
                    fill="none"
                    strokeWidth={0.8}
                    className="absolute inset-0 size-full stroke-white opacity-[0.16] dark:stroke-black dark:opacity-[0.14]"
                  >
                    {SLEEVE_WAVES.map((d, i) => (
                      <path key={i} d={d} />
                    ))}
                  </svg>
                  <div aria-hidden className="ecos-fade-tr absolute inset-0 opacity-60">
                    <div className="ecos-foil ecos-hairlines absolute inset-0" />
                  </div>
                  <div className="relative mt-auto">
                    <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] opacity-85">{weekday}</p>
                    <p className="mt-1.5 font-display text-[length:calc(var(--s)*0.37)] font-extrabold uppercase leading-[0.82] tracking-[-0.06em]">
                      <span className="block">{dayNumber}</span>
                      <span className="block">{month}</span>
                    </p>
                    <p className="mt-2 font-mono text-[11px] font-bold tracking-[0.1em] opacity-80">{year}</p>
                  </div>
                </div>
              )}
              {gameNumber != null && (
                <span className="ecos-foil absolute bottom-3 right-3 z-10 rotate-[-5deg] rounded-[9px] px-[11px] py-1.5 font-mono text-[17px] font-extrabold tracking-[0.04em] text-[#0b1f16] shadow-[0_8px_16px_-8px_rgba(0,0,0,0.45),inset_0_0_0_1px_rgba(255,255,255,0.5)]">
                  #{gameNumber}
                </span>
              )}
            </div>

            {/* Pegatina redonda entre funda y disco */}
            <span
              className={cn(
                "absolute -top-2 z-20 flex size-[66px] rotate-12 items-center justify-center rounded-full p-1.5 text-center font-mono text-[8.5px] font-extrabold uppercase leading-[1.2] tracking-[0.03em] shadow-[0_6px_14px_-6px_rgba(0,0,0,0.45),inset_0_0_0_1px_rgba(255,255,255,0.5)]",
                sticker.foil ? "ecos-foil text-[#0b1f16]" : "bg-destructive text-white"
              )}
              style={{ left: "calc(var(--s) * 0.796)" }}
            >
              {sticker.label}
            </span>

            {/* Placa de puntos, sobre el disco */}
            {completed && (
              <div className="absolute bottom-1.5 right-1.5 z-20 rounded-2xl border border-border bg-card px-3 py-2 text-center shadow-[0_12px_24px_-12px_rgba(0,0,0,0.4)]">
                <AnimatedNumber
                  value={score ?? 0}
                  format={formatNumber}
                  delay={0.3}
                  className={cn(
                    "block font-display text-[28px] font-extrabold leading-[0.9] tracking-[-0.04em]",
                    score ? "text-brand" : "text-destructive"
                  )}
                />
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {t("points")}
                </span>
              </div>
            )}
          </div>

          {/* Texto */}
          {completed ? (
            <div className={cn(RISE, "flex items-end justify-between gap-3")} style={riseDelay(1)}>
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
                    won ? "text-brand" : "text-destructive"
                  )}
                >
                  {won ? t("heroRevealWon") : t("heroRevealLost")}
                </p>
                <h2
                  className="mt-1 line-clamp-2 font-display text-[23px] font-extrabold leading-[1.05] tracking-[-0.03em]"
                  title={title || undefined}
                >
                  {title || "—"}
                </h2>
                {artist ? <p className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">{artist}</p> : null}
              </div>
              <AttemptsStrip slots={slots} current={-1} className="mb-1.5" />
            </div>
          ) : (
            <div className={cn(RISE, "flex flex-col gap-2.5")} style={riseDelay(1)}>
              <h2 className="font-display text-[28px] font-extrabold leading-none tracking-[-0.035em]">
                {inProgress ? t.rich("heroTitleInProgress", { em }) : t.rich("heroTitleNew", { em })}
              </h2>
              {inProgress && (
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <AttemptsStrip slots={slots} current={guesses.length} />
                  <span>{t("heroAttemptsLeft", { count: attemptsLeft })}</span>
                </div>
              )}
            </div>
          )}

          {/* Acciones */}
          <div className={cn(RISE, "flex items-center gap-2.5")} style={riseDelay(2)}>
            <motion.button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              onFocus={onPrefetch}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.96 }}
              className={cn(
                "flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-bold transition-shadow",
                completed
                  ? "border border-border bg-background/70 text-foreground backdrop-blur hover:bg-background"
                  : "ecos-shimmer bg-brand text-primary-foreground shadow-[0_10px_30px_-10px_var(--brand)]"
              )}
            >
              <span
                aria-hidden
                className="material-symbols-outlined text-[22px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {completed ? "visibility" : "play_arrow"}
              </span>
              {completed ? t("viewResult") : inProgress ? t("continuePlaying") : t("playNow")}
            </motion.button>
            <motion.button
              type="button"
              onClick={onShare}
              whileTap={{ scale: 0.88, rotate: -8 }}
              aria-label={tc("share")}
              className={cn(
                "flex size-[52px] shrink-0 items-center justify-center rounded-full transition-colors",
                completed
                  ? "bg-brand text-primary-foreground shadow-[0_10px_30px_-10px_var(--brand)]"
                  : "border border-border bg-card text-foreground hover:bg-muted"
              )}
            >
              <span aria-hidden className="material-symbols-outlined text-xl">
                ios_share
              </span>
            </motion.button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/** Franja de seis tramos con el color de cada intento; el actual parpadea. */
function AttemptsStrip({
  slots,
  current,
  className,
}: {
  slots: (AttemptKind | null)[];
  current: number;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 gap-[5px]", className)} aria-hidden>
      {slots.map((kind, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-[22px] rounded-full",
            kind
              ? ATTEMPT_KIND_STYLES[kind].solid
              : i === current
                ? "animate-pulse bg-brand"
                : "bg-foreground/10"
          )}
        />
      ))}
    </div>
  );
}
