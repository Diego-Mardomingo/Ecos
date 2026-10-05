"use client";

import { useTranslations } from "next-intl";
import { motion, type Variants } from "framer-motion";
import { ATTEMPT_DURATIONS } from "@/lib/store/gameStore";
import { BASE_SCORES } from "@/lib/scoring";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { WaveformBars } from "@/components/home/HomeWaveform";
import { ABOUT_HOW_TO_PLAY_ICONS } from "@/components/home/homeHelpers";

/**
 * Hoja «Cómo jugar»: qué es ECOS, cómo crece el fragmento, los pasos de una partida y cuántos
 * puntos da cada intento.
 *
 * Lo de los segundos y los puntos no es texto suelto: sale de `ATTEMPT_DURATIONS` y `BASE_SCORES`,
 * así que si cambian las reglas del juego la hoja se actualiza sola.
 */

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

/** Puntos máximos posibles: el ancho de referencia de las barras de puntos. */
const MAX_POINTS = BASE_SCORES[1];

export function HowToPlaySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const { formatNumber } = useAppFormatters();
  const steps = t.raw("howToPlayStepsList") as { title: string; desc: string }[];

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("aboutTitle")}
      description={t("aboutAccessibilitySummary")}
      hideDescription
      footer={
        <motion.button
          type="button"
          onClick={() => onOpenChange(false)}
          whileTap={{ scale: 0.97 }}
          className="flex h-[52px] w-full items-center justify-center rounded-2xl bg-brand text-[15px] font-bold text-primary-foreground shadow-[0_12px_30px_-14px_var(--brand)]"
        >
          {t("gotIt")}
        </motion.button>
      }
    >
      <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col gap-6">
        {/* Qué es. Tinte de la marca sobre el fondo de la hoja, no un negro fijo: así casa con el
            tema claro igual que con el oscuro. */}
        <motion.section
          variants={rise}
          className="relative isolate overflow-hidden rounded-3xl border border-brand/20 bg-brand/[0.07] px-5 pb-5 pt-4"
        >
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background: "radial-gradient(90% 70% at 50% 0%, color-mix(in srgb, var(--brand) 18%, transparent), transparent 70%)",
            }}
          />
          <div className="h-10 [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]">
            <WaveformBars />
          </div>
          <p className="mt-3 font-display text-xl font-bold tracking-[-0.02em]">{t("aboutTagline")}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t("aboutBody")}</p>
        </motion.section>

        {/* El fragmento crece. Fichas iguales en vez de barras de altura proporcional: de 1 s a 30 s
            hay demasiado salto para dibujarlo a escala, y comprimido (raíz cuadrada) el de 1 s
            quedaba como una pastilla aplastada. El crecimiento lo cuenta el medidor de cada ficha. */}
        <motion.section variants={rise}>
          <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("howToPlayClipTitle")}
          </h3>
          <ol className="grid grid-cols-3 gap-2">
            {ATTEMPT_DURATIONS.map((seconds, i) => {
              const isLast = i === ATTEMPT_DURATIONS.length - 1;
              return (
                <motion.li
                  key={seconds}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.06, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "flex flex-col gap-2 rounded-2xl border px-3 pb-3 pt-2.5",
                    isLast ? "border-brand/30 bg-brand/[0.07]" : "border-border bg-background/60"
                  )}
                >
                  <span className="text-[11px] font-medium text-muted-foreground">{t("howToPlayAttempt", { n: i + 1 })}</span>
                  <span className={cn("font-mono text-xl font-bold leading-none tabular-nums", isLast && "text-brand")}>
                    {seconds}s
                  </span>
                  <span aria-hidden className="flex gap-0.5">
                    {ATTEMPT_DURATIONS.map((_, j) => (
                      <span key={j} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        {j <= i ? (
                          <motion.span
                            className="block h-full origin-left rounded-full bg-brand"
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{ delay: 0.45 + i * 0.06 + j * 0.04, duration: 0.3, ease: "easeOut" }}
                          />
                        ) : null}
                      </span>
                    ))}
                  </span>
                </motion.li>
              );
            })}
          </ol>
        </motion.section>

        {/* Pasos */}
        <motion.section variants={rise}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("howToPlayTitle")}
          </h3>
          <ol className="relative">
            {/* Hilo que une los pasos, por detrás de los iconos. */}
            <span aria-hidden className="absolute bottom-6 left-5 top-6 w-px bg-gradient-to-b from-brand/50 via-border to-transparent" />
            {steps.map((step, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.07, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="relative flex gap-3.5 py-2"
              >
                <span className="relative grid size-10 shrink-0 place-items-center rounded-2xl bg-card text-brand ring-1 ring-brand/30">
                  <span aria-hidden className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {ABOUT_HOW_TO_PLAY_ICONS[i] ?? "music_note"}
                  </span>
                  <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-brand font-mono text-[9px] font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-[15px] font-semibold leading-snug">{step.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{step.desc}</p>
                </div>
              </motion.li>
            ))}
          </ol>
        </motion.section>

        {/* Puntos */}
        <motion.section variants={rise}>
          <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("howToPlayPointsTitle")}
          </h3>
          <ul className="space-y-1.5 rounded-3xl border border-border bg-background/60 p-3">
            {ATTEMPT_DURATIONS.map((_, i) => {
              const points = BASE_SCORES[i + 1];
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="w-[4.5rem] shrink-0 text-xs font-medium text-muted-foreground">
                    {t("howToPlayAttempt", { n: i + 1 })}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <motion.span
                      className="block h-full rounded-full bg-brand"
                      initial={{ width: 0 }}
                      animate={{ width: `${(points / MAX_POINTS) * 100}%` }}
                      transition={{ delay: 0.6 + i * 0.06, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right font-mono text-xs font-semibold tabular-nums">
                    {formatNumber(points)} {tc("points")}
                  </span>
                </li>
              );
            })}
          </ul>
        </motion.section>
      </motion.div>
    </BottomSheet>
  );
}
