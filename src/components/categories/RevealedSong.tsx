"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CategoryRunRevealedSong } from "@/lib/categories/types";
import { cn } from "@/lib/utils";

const EASE_OUT = "[--tw-ease:cubic-bezier(0.22,1,0.36,1)]";

/**
 * Canción recién resuelta de una racha: carátula, título, artista y álbum. Es lo único que el
 * servidor revela, y solo cuando la canción ya está resuelta. Entra en CSS (no en framer): así se
 * ve desde el primer pintado.
 */
export function RevealedSong({
  song,
  won,
  verdict,
}: {
  song: CategoryRunRevealedSong;
  won: boolean;
  verdict: string;
}) {
  const t = useTranslations("game");
  const album = song.album_title?.trim();

  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <div
        className={cn(
          "relative size-[180px] shrink-0 overflow-hidden rounded-2xl shadow-[0_24px_50px_-16px_rgba(0,0,0,0.75)] ring-1 ring-white/10",
          "animate-in fade-in zoom-in-82 blur-in-14 animation-duration-700",
          EASE_OUT
        )}
      >
        {song.cover_url ? (
          <Image src={song.cover_url} alt={song.title} fill className="object-cover" sizes="180px" priority />
        ) : (
          <div className="size-full bg-gradient-to-br from-brand/30 to-card" />
        )}
      </div>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1",
          won ? "bg-brand/12 text-brand ring-brand/30" : "bg-destructive/10 text-destructive ring-destructive/30"
        )}
      >
        <span aria-hidden className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
          {won ? "celebration" : "heart_broken"}
        </span>
        {verdict}
      </span>
      <div
        className={cn(
          "flex w-full flex-col items-center gap-1 animate-in fade-in slide-in-from-bottom-4 animation-duration-500 [--tw-animation-delay:250ms] fill-mode-backwards",
          EASE_OUT
        )}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t("revealingSong")}
        </p>
        <h2 className="text-balance text-2xl font-bold leading-tight tracking-tight">{song.title}</h2>
        <p className="text-base text-muted-foreground">{song.artist_name}</p>
        {album ? (
          <p className="mt-1 max-w-full truncate rounded-full border border-border bg-card/70 px-2.5 py-1 text-xs text-muted-foreground">
            {album}
          </p>
        ) : null}
      </div>
    </div>
  );
}
