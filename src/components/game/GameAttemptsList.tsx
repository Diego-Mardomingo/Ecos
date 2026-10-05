"use client";

import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { ATTEMPT_DURATIONS } from "@/lib/store/gameStore";
import { cn } from "@/lib/utils";
import {
  ATTEMPT_KIND_STYLES,
  attemptKind,
  type AttemptOutcome,
} from "@/components/game/attemptOutcome";

/**
 * Lista de intentos ya hechos, del más reciente al más antiguo, con la etiqueta de por qué falló
 * cada uno. El intento nuevo entra por arriba y empuja a los demás (`layout`), así que se ve
 * llegar en lugar de aparecer.
 */

function parseGuessText(text: string) {
  const sep = text.lastIndexOf(" - ");
  if (sep === -1) return { title: text, artist: "" };
  return { title: text.slice(0, sep).trim(), artist: text.slice(sep + 3).trim() };
}

function PreviousAttempts({
  guesses,
  title,
  className,
}: {
  guesses: Array<AttemptOutcome & { text: string }>;
  title?: string;
  className?: string;
}) {
  const t = useTranslations("game");
  const items = guesses.map((g, index) => ({ g, index })).reverse();

  return (
    <section className={cn("mt-5", className)}>
      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title ?? t("previousAttempts")}
      </h3>
      <ol className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map(({ g, index }) => {
            const kind = attemptKind(g);
            const style = ATTEMPT_KIND_STYLES[kind];
            const { title: songTitle, artist } = kind === "skipped" ? { title: "", artist: "" } : parseGuessText(g.text);
            return (
              <motion.li
                key={index}
                layout
                initial={{ opacity: 0, y: -14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
                className={cn("flex items-center gap-3 rounded-2xl border px-3 py-2.5", style.soft)}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-xl",
                    kind === "skipped" ? "bg-muted" : "bg-background/60"
                  )}
                >
                  <motion.span
                    initial={{ scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 20, delay: 0.08 }}
                    aria-hidden
                    className={cn("material-symbols-outlined text-lg font-bold", style.text)}
                  >
                    {style.icon}
                  </motion.span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-xs font-semibold", style.text)}>{t(style.labelKey)}</p>
                  {songTitle ? <p className="truncate text-sm font-medium">{songTitle}</p> : null}
                  {artist ? <p className="truncate text-xs text-muted-foreground">{artist}</p> : null}
                </div>
                <span className="shrink-0 rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {ATTEMPT_DURATIONS[index] ?? 30}s
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </section>
  );
}

export { PreviousAttempts };
