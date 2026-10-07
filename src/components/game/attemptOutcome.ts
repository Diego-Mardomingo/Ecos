import { SKIPPED_GUESS_TEXT } from "@/lib/store/gameStore";

/**
 * Clasificación de un intento y su lenguaje visual (color, icono, etiqueta).
 *
 * La misma cascada —acierto, álbum, artista, salto, fallo— estaba escrita a mano en la franja
 * de intentos, en la lista de intentos y en las tarjetas de la home, cada una con sus clases.
 * Aquí vive una sola vez para que un intento se pinte igual en todas partes.
 */

/** Forma mínima de un intento; `GuessEntry` e `InProgressProgress["guesses"]` la cumplen. */
export type AttemptOutcome = {
  text?: string;
  correct?: boolean;
  correctArtist?: boolean;
  correctAlbum?: boolean;
};

export type AttemptKind = "correct" | "album" | "artist" | "skipped" | "wrong";

export function attemptKind(guess: AttemptOutcome): AttemptKind {
  if (guess.correct) return "correct";
  if (guess.text === SKIPPED_GUESS_TEXT) return "skipped";
  if (guess.correctAlbum) return "album";
  if (guess.correctArtist) return "artist";
  return "wrong";
}

export const ATTEMPT_KIND_STYLES: Record<
  AttemptKind,
  {
    /** Relleno sólido (tramos de la franja, puntos). */
    solid: string;
    /** Texto e icono. */
    text: string;
    /** Fondo suave + borde (tarjetas de intento). */
    soft: string;
    /** Glifo de Material Symbols. */
    icon: string;
    /** Clave de `game.*` con la etiqueta. */
    labelKey: string;
  }
> = {
  correct: {
    solid: "bg-brand",
    text: "text-brand",
    soft: "bg-brand/10 border-brand/35",
    icon: "check",
    labelKey: "correct",
  },
  album: {
    solid: "bg-violet-500",
    text: "text-violet-600 dark:text-violet-400",
    soft: "bg-violet-500/10 border-violet-500/30",
    icon: "album",
    labelKey: "correctAlbum",
  },
  artist: {
    solid: "bg-teal-500",
    text: "text-teal-600 dark:text-teal-400",
    soft: "bg-teal-500/10 border-teal-500/30",
    icon: "person",
    labelKey: "correctArtist",
  },
  skipped: {
    solid: "bg-muted-foreground/50",
    text: "text-muted-foreground",
    soft: "bg-muted/50 border-border",
    icon: "skip_next",
    labelKey: "skipped",
  },
  wrong: {
    solid: "bg-destructive",
    text: "text-destructive",
    soft: "bg-destructive/10 border-destructive/30",
    icon: "close",
    labelKey: "wrongSong",
  },
};
