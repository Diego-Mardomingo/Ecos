"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Lista de intentos ya hechos, con la etiqueta de por qué falló cada uno.
 * Extraído de `GameClient` sin cambios de lógica.
 */

const GUESS_LABEL_KEYS: Record<string, string> = {
  CORRECT: "correct",
  WRONG_SONG: "wrongSong",
  CORRECT_ARTIST: "correctArtist",
  CORRECT_ALBUM: "correctAlbum",
  CORRECT_ARTIST_ALBUM: "correctArtistAlbum",
  WRONG: "wrong",
  SKIPPED: "skipped",
};

function PreviousAttempts({
  guesses,
}: {
  guesses: Array<{ text: string; correct?: boolean; correctArtist?: boolean; correctAlbum?: boolean }>;
}) {
  const t = useTranslations("game");
  const reversed = [...guesses].reverse();

  const parseGuessText = (text: string) => {
    const sep = text.lastIndexOf(" - ");
    if (sep === -1) return { title: text, artist: "" };
    return { title: text.slice(0, sep).trim(), artist: text.slice(sep + 3).trim() };
  };

  const attemptCard = (
    g: (typeof guesses)[0],
    i: number,
    labelKey: string,
    bgClass: string,
    labelClass: string,
    icon: string,
    iconClass: string
  ) => {
    const { title, artist } = parseGuessText(g.text);
    return (
      <div
        key={i}
        className={cn(
          "flex min-h-[44px] flex-row items-center gap-2.5 rounded-lg border px-2.5 py-2",
          bgClass
        )}
      >
        {/* Icono centrado verticalmente */}
        <div className="flex w-14 shrink-0 items-center justify-center sm:w-auto sm:block">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50">
            <span aria-hidden
              className={cn("material-symbols-outlined text-lg", iconClass)}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {icon}
            </span>
          </div>
        </div>
        {/* Contenido: etiqueta, título y artista alineados a la izquierda */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className={cn("text-xs font-semibold", labelClass)}>
            {t(GUESS_LABEL_KEYS[labelKey] as string)}
          </span>
          {title ? <p className="break-words text-sm font-medium">{title}</p> : null}
          {artist ? (
            <p className="break-words text-xs text-muted-foreground">{artist}</p>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">
        {t("previousAttempts")}
      </h3>
      <div className="flex flex-col gap-2">
        {reversed.map((g, i) => {
          const origIndex = guesses.length - 1 - i;
          if (g.text === "skipped") {
            return (
              <div
                key={origIndex}
                className="flex min-h-[44px] flex-row items-center gap-2.5 rounded-lg border border-destructive/40 bg-destructive/15 px-2.5 py-2"
              >
                <div className="flex w-14 shrink-0 items-center justify-center sm:w-auto sm:block">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50">
                    <span aria-hidden
                      className="material-symbols-outlined text-lg text-destructive"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      skip_next
                    </span>
                  </div>
                </div>
                <span className="text-left text-xs font-semibold text-destructive">
                  {t("skipped")}
                </span>
              </div>
            );
          }
          let labelKey = "WRONG";
          let bgClass = "bg-destructive/15 border-destructive/40";
          let labelClass = "text-destructive";
          let icon = "close";
          let iconClass = "text-destructive";
          if (g.correct) {
            labelKey = "CORRECT";
            bgClass = "bg-brand/15 border-brand/40";
            labelClass = "text-brand";
            icon = "check_circle";
            iconClass = "text-brand";
          } else if (g.correctArtist || g.correctAlbum) {
            labelKey = g.correctAlbum ? "CORRECT_ALBUM" : "CORRECT_ARTIST";
            if (g.correctAlbum) {
              bgClass = "bg-violet-500/15 border-violet-500/30";
              labelClass = "text-violet-600 dark:text-violet-400";
              icon = "album";
              iconClass = "text-violet-600 dark:text-violet-400";
            } else {
              bgClass = "bg-teal-500/15 border-teal-500/30";
              labelClass = "text-teal-600 dark:text-teal-400";
              icon = "person";
              iconClass = "text-teal-600 dark:text-teal-400";
            }
          } else {
            labelKey = "WRONG_SONG";
          }
          return attemptCard(g, origIndex, labelKey, bgClass, labelClass, icon, iconClass);
        })}
      </div>
    </div>
  );
}

export { PreviousAttempts };
