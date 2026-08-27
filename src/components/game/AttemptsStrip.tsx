"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { ATTEMPT_DURATIONS } from "@/lib/store/gameStore";
import { cn } from "@/lib/utils";

/**
 * Franja de intentos: un tramo por intento, con el ancho creciendo con la duración de su
 * fragmento (1s → 30s) en escala raíz, para que el tramo de 1s siga siendo visible junto al de
 * 30s. Ocupa el sitio de la antigua barra de progreso de audio, que duplicaba al anillo del
 * botón, y sustituye también a los puntos de intento de la pantalla de resultado.
 *
 * Dos usos:
 * - Partida en curso: `currentAttempt` marca el intento activo y `audioDuration` pinta el pie.
 * - Resultado final: sin `currentAttempt` no hay tramo activo, y sin `audioDuration` no hay pie
 *   (la pantalla de resultado ya dice "4 de 6 intentos" justo debajo).
 */

/** Forma mínima que necesita la franja; `GuessEntry` la cumple. */
type AttemptOutcome = {
  correct?: boolean;
  correctArtist?: boolean;
  correctAlbum?: boolean;
};

const AttemptsStrip = memo(function AttemptsStrip({
  guesses,
  maxAttempts,
  currentAttempt = null,
  correctAttempt = null,
  audioDuration = null,
  className,
}: {
  guesses: AttemptOutcome[];
  maxAttempts: number;
  /** Intento en curso (1-based). `null` en el resultado final: ya no hay intento activo. */
  currentAttempt?: number | null;
  /**
   * Intento acertado (1-based). Solo se usa como respaldo cuando no llegan los intentos uno a
   * uno: la pantalla de resultado puede renderizarse con `guesses` vacío.
   */
  correctAttempt?: number | null;
  /** Segundos del fragmento del intento en curso. Si falta, no se pinta el pie. */
  audioDuration?: number | null;
  className?: string;
}) {
  const t = useTranslations("game");
  const showCaption = currentAttempt != null && audioDuration != null;

  return (
    <div className={cn("w-full", className)}>
      <div className="flex w-full items-end gap-[3px]" aria-hidden>
        {Array.from({ length: maxAttempts }).map((_, i) => {
          const seconds = ATTEMPT_DURATIONS[i] ?? 30;
          const guess = guesses[i];
          const isCurrent = currentAttempt != null && i === currentAttempt - 1;
          const isPlayed = i < guesses.length;
          // Respaldo sin `guesses`: los intentos hasta el acertado se pintan por su posición.
          const isPlayedByCorrectAttempt =
            !isPlayed && correctAttempt != null && i < correctAttempt;
          const wonHere = correctAttempt != null && i === correctAttempt - 1;

          return (
            <div
              key={i}
              className="flex flex-col items-center gap-1"
              style={{ flex: `${Math.sqrt(seconds)} 1 0` }}
            >
              <span
                className={cn(
                  "text-[10px] font-medium leading-[13px] tabular-nums",
                  isCurrent
                    ? "font-bold text-brand"
                    : isPlayed || isPlayedByCorrectAttempt
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60"
                )}
              >
                {seconds}s
              </span>
              <div
                className={cn(
                  "h-2.5 w-full rounded-full transition-colors",
                  isCurrent
                    ? "bg-brand ring-[3px] ring-brand/20"
                    : isPlayed
                      ? guess?.correct
                        ? "bg-brand"
                        : guess?.correctAlbum
                          ? "bg-violet-500"
                          : guess?.correctArtist
                            ? "bg-teal-500"
                            : "bg-destructive"
                      : isPlayedByCorrectAttempt
                        ? wonHere
                          ? "bg-brand"
                          : "bg-destructive"
                        : "bg-muted"
                )}
              />
            </div>
          );
        })}
      </div>

      {showCaption && (
        <div className="mt-2 flex w-full items-baseline justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("attemptOfMax", {
              attempt: Math.min(currentAttempt, maxAttempts),
              max: maxAttempts,
            })}
          </span>
          <span className="text-[11px] font-bold tabular-nums text-brand">
            {t("fragmentSeconds", { seconds: audioDuration })}
          </span>
        </div>
      )}
    </div>
  );
});

export { AttemptsStrip };
