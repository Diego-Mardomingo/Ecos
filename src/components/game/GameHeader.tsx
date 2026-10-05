"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format, parseISO } from "date-fns";
import { Link } from "@/i18n/navigation";
import { useAppFormatters } from "@/lib/hooks/useAppFormatters";
import { useNavigateBackToHome } from "@/lib/navigation/useNavigateBackToHome";
import type { GameWithSong } from "@/lib/queries/games";

/**
 * Patrón de fecha por idioma. En código y no en los mensajes: el apóstrofo es el escape de ICU,
 * así que next-intl se comería las comillas de `'de'` y date-fns leería «de» como patrón.
 */
const DATE_PATTERNS: Record<string, string> = {
  es: "EEEE, d 'de' MMMM",
  en: "EEEE, MMMM d",
};

/** Solo la primera letra: los meses en español van en minúscula («Domingo, 4 de octubre»). */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Cabecera fija de la partida: volver, número de reto + fecha, y un hueco a la derecha para la
 * acción de cada pantalla (saltar en juego, nada en el resultado).
 *
 * Estaba copiada tres veces en `GameClient` y `GameResultScreen` (carga, juego y resultado).
 * Incluye su propio espaciador, porque al ser `fixed` no ocupa sitio en el flujo.
 */
export function GameHeader({ game, action }: { game: GameWithSong; action?: ReactNode }) {
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { dateFnsLocale } = useAppFormatters();
  const navigateBackToHome = useNavigateBackToHome();

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-50 pt-safe backdrop-blur-xl"
        style={{ background: "color-mix(in srgb, var(--background) 80%, transparent)" }}
      >
        <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-2 px-4">
          <Link
            href="/"
            onClick={navigateBackToHome}
            className="group flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-foreground transition-[transform,border-color] duration-200 hover:border-brand/40 active:scale-90"
            aria-label={tc("back")}
          >
            <span aria-hidden className="material-symbols-outlined text-xl transition-transform duration-200 group-hover:-translate-x-0.5">
              arrow_back
            </span>
          </Link>
          <h1 className="min-w-0 flex-1 text-center leading-tight">
            <span className="block text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
              {t("challengeNumber", { number: game.game_number })}
            </span>
            <span className="block truncate text-xs font-medium text-muted-foreground">
              {capitalize(format(parseISO(game.date), DATE_PATTERNS[locale] ?? DATE_PATTERNS.en, { locale: dateFnsLocale }))}
            </span>
          </h1>
          <div className="flex min-w-10 shrink-0 justify-end">{action}</div>
        </div>
      </header>
      <div className="h-14 shrink-0 pt-safe box-content" aria-hidden />
    </>
  );
}
