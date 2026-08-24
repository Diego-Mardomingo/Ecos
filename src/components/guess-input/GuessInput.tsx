"use client";

import { useState, useCallback, useRef, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchSongs } from "@/lib/hooks/queries";
import { cn } from "@/lib/utils";
import Image from "next/image";

export type { EcosSong } from "@/lib/hooks/queries";

type Song = import("@/lib/hooks/queries").EcosSong;

interface GuessInputProps {
  onGuess: (song: Song) => void;
  disabled?: boolean;
  className?: string;
  /** Textos de canciones ya elegidas (ej. "Title - Artist") para resaltarlas en el listado */
  alreadyGuessedTexts?: string[];
}

const DEBOUNCE_MS = 350;

/**
 * Combobox de búsqueda de canciones, siguiendo el patrón ARIA de combobox con lista de
 * autocompletado: `role="combobox"` en el input, `role="listbox"`/`option` en el desplegable y
 * `aria-activedescendant` para marcar la opción activa sin mover el foco fuera del input.
 *
 * Esa última parte es la clave: el foco **nunca** sale del input, así que se puede seguir
 * escribiendo mientras se navega con las flechas. Por eso las opciones son `<li role="option">`
 * y no `<button>`: un botón sería un punto de tabulación propio y rompería ese modelo.
 */
export function GuessInput({ onGuess, disabled, className, alreadyGuessedTexts = [] }: GuessInputProps) {
  const t = useTranslations("game");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** Índice de la opción activa; -1 = ninguna (el input manda). */
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const { data: results = [], isLoading } = useSearchSongs(debouncedQuery);

  const isGuessed = useCallback(
    (song: Song) => {
      const guessText = `${song.title} - ${song.artist_name}`.toLowerCase().trim();
      return alreadyGuessedTexts.some((x) => x.toLowerCase().trim() === guessText);
    },
    [alreadyGuessedTexts]
  );

  /**
   * Si cambia el conjunto de resultados, la opción activa deja de tener sentido. Se ajusta el
   * estado durante el render en lugar de en un efecto, que es lo que exige el compilador de
   * React (ver `react-hooks/set-state-in-effect` en CLAUDE.md).
   */
  const resultsKey = results.map((r) => r.id).join(",");
  const [lastResultsKey, setLastResultsKey] = useState(resultsKey);
  if (resultsKey !== lastResultsKey) {
    setLastResultsKey(resultsKey);
    setActiveIndex(-1);
  }

  const closeList = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    setActiveIndex(-1);
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
    (song: Song) => {
      setQuery("");
      setDebouncedQuery("");
      setOpen(false);
      setActiveIndex(-1);
      onGuess(song);
    },
    [onGuess]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const count = results.length;

      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp": {
          if (count === 0) return;
          event.preventDefault();
          if (!open) {
            setOpen(true);
            setActiveIndex(event.key === "ArrowDown" ? 0 : count - 1);
            return;
          }
          setActiveIndex((prev) => {
            const step = event.key === "ArrowDown" ? 1 : -1;
            // Ciclo: desde "ninguna" (-1) la primera flecha entra por el extremo que toca.
            if (prev === -1) return step === 1 ? 0 : count - 1;
            return (prev + step + count) % count;
          });
          return;
        }
        case "Home":
        case "End": {
          if (!open || count === 0) return;
          event.preventDefault();
          setActiveIndex(event.key === "Home" ? 0 : count - 1);
          return;
        }
        case "Enter": {
          if (!open || activeIndex < 0) return;
          const song = results[activeIndex];
          if (!song || isGuessed(song)) return;
          event.preventDefault();
          handleSelect(song);
          return;
        }
        case "Escape": {
          if (!open) return;
          event.preventDefault();
          closeList();
          return;
        }
        case "Tab": {
          // Salir del campo cierra la lista, sin bloquear la tabulación.
          if (open) closeList();
          return;
        }
        default:
          return;
      }
    },
    [results, open, activeIndex, isGuessed, handleSelect, closeList]
  );

  /**
   * Cierre por puntero fuera del componente. `pointerdown` en vez de `mousedown` para cubrir
   * también táctil y lápiz, que era una de las carencias: en móvil la lista no se cerraba.
   */
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);

  /** Mantener visible la opción activa al navegar con el teclado. */
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listboxRef.current;
    if (!list) return;
    const el = list.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  });

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const isExpanded = open && results.length > 0;

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full group", className)}
      // Cierra al salir del componente con el teclado (Tab). Las opciones evitan robar el foco
      // con preventDefault en pointerdown, así que un clic en una opción no pasa por aquí.
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
          closeList();
        }
      }}
    >
      <div className="relative">
        <span
          aria-hidden
          className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-xl text-muted-foreground transition-colors group-focus-within:text-brand"
        >
          search
        </span>
        <input
          type="text"
          role="combobox"
          aria-label={t("searchLabel")}
          aria-expanded={isExpanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            isExpanded && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          autoComplete="off"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          disabled={disabled}
          placeholder={t("typeToSearch")}
          className={cn(
            "w-full rounded-xl border-2 border-transparent bg-muted py-4 pl-12 pr-4 text-base outline-none transition-all placeholder:text-muted-foreground",
            "focus:border-brand/50 focus:ring-0",
            disabled && "cursor-not-allowed opacity-50"
          )}
        />
        {isLoading && (
          <span
            aria-hidden
            className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-xl text-brand"
          >
            progress_activity
          </span>
        )}
      </div>

      {/* Anuncia el número de resultados a los lectores de pantalla: sin esto la lista aparece
          en silencio y no hay forma de saber que hay algo que elegir. */}
      <p aria-live="polite" role="status" className="sr-only">
        {isExpanded
          ? t("searchResultsCount", { count: results.length })
          : debouncedQuery && !isLoading
            ? t("searchNoResults")
            : ""}
      </p>

      <AnimatePresence>
        {isExpanded && (
          <motion.ul
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label={t("searchLabel")}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full z-50 mb-2 flex max-h-64 w-full flex-col overflow-hidden overflow-y-auto rounded-2xl border border-border bg-card shadow-xl shadow-black/20"
          >
            {results.map((song, index) => {
              const isAlreadyGuessed = isGuessed(song);
              const isActive = index === activeIndex;
              return (
                <li
                  key={song.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={isAlreadyGuessed}
                  // El foco se queda en el input: sin esto, pulsar una opción lo perdería y el
                  // onBlur del contenedor cerraría la lista antes de que llegue el clic.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => !isAlreadyGuessed && handleSelect(song)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    isAlreadyGuessed
                      ? "cursor-not-allowed bg-destructive/15 opacity-70"
                      : "cursor-pointer active:bg-muted/70",
                    isActive && !isAlreadyGuessed && "bg-muted"
                  )}
                >
                  <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                    {song.cover_url ? (
                      <Image
                        src={song.cover_url}
                        alt=""
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="material-symbols-outlined absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xl text-muted-foreground"
                      >
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
                  {isAlreadyGuessed && (
                    <span className="sr-only">{t("optionAlreadyGuessed")}</span>
                  )}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
