"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchSongs } from "@/lib/hooks/queries";
import { cn } from "@/lib/utils";
import Image from "next/image";

export type { EcosSong } from "@/lib/hooks/queries";

interface GuessInputProps {
  onGuess: (song: import("@/lib/hooks/queries").EcosSong) => void;
  disabled?: boolean;
  className?: string;
  /** Textos de canciones ya elegidas (ej. "Title - Artist") para resaltarlas en el listado */
  alreadyGuessedTexts?: string[];
}

const DEBOUNCE_MS = 350;

export function GuessInput({ onGuess, disabled, className, alreadyGuessedTexts = [] }: GuessInputProps) {
  const t = useTranslations("game");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: results = [], isLoading } = useSearchSongs(debouncedQuery);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setDebouncedQuery("");
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim());
      setOpen(true);
    }, DEBOUNCE_MS);
  }, []);

  const handleSelect = useCallback(
    (song: import("@/lib/hooks/queries").EcosSong) => {
      setQuery("");
      setDebouncedQuery("");
      setOpen(false);
      onGuess(song);
    },
    [onGuess]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-xl text-muted-foreground">
          search
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          disabled={disabled}
          placeholder={t("typeToSearch")}
          className={cn(
            "w-full rounded-2xl border border-border bg-card py-3.5 pl-10 pr-4 text-sm outline-none transition-all",
            "placeholder:text-muted-foreground",
            "focus:border-brand focus:ring-2 focus:ring-brand/20",
            disabled && "cursor-not-allowed opacity-50"
          )}
        />
        {isLoading && (
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-xl text-brand">
            progress_activity
          </span>
        )}
      </div>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full z-50 mb-2 flex max-h-64 w-full flex-col overflow-hidden overflow-y-auto rounded-2xl border border-border bg-card shadow-xl shadow-black/20"
          >
            {results.map((song) => {
              const guessText = `${song.title} - ${song.artist_name}`;
              const isAlreadyGuessed = alreadyGuessedTexts.some(
                (t) => t.toLowerCase().trim() === guessText.toLowerCase().trim()
              );
              return (
              <li key={song.id}>
                <button
                  type="button"
                  disabled={isAlreadyGuessed}
                  onClick={() => !isAlreadyGuessed && handleSelect(song)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    isAlreadyGuessed
                      ? "cursor-not-allowed opacity-70"
                      : "hover:bg-muted active:bg-muted/70",
                    isAlreadyGuessed && "bg-destructive/15"
                  )}
                >
                  <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                    {song.cover_url ? (
                      <Image
                        src={song.cover_url}
                        alt={song.title}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="material-symbols-outlined absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xl text-muted-foreground">
                        music_note
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", isAlreadyGuessed && "text-destructive")}>
                      {song.title}
                    </p>
                    <p className={cn("truncate text-xs", isAlreadyGuessed ? "text-destructive/80" : "text-muted-foreground")}>
                      {song.artist_name}
                    </p>
                  </div>
                </button>
              </li>
            );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
