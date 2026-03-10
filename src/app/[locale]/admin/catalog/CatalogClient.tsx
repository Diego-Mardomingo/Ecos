"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

type Song = {
  id: string;
  title: string | null;
  artist_name: string | null;
  cover_url: string | null;
  is_active: boolean;
  youtube_verified: boolean;
};

export function CatalogClient({ songs }: { songs: Song[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!q.trim()) return songs;
    const lower = q.trim().toLowerCase();
    return songs.filter(
      (s) =>
        (s.title?.toLowerCase().includes(lower) ?? false) ||
        (s.artist_name?.toLowerCase().includes(lower) ?? false)
    );
  }, [songs, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Catálogo
        </h2>
        <div className="relative w-full sm:w-80">
          <span
            className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 block -translate-y-1/2 text-base leading-none text-muted-foreground"
            style={{ fontVariationSettings: "'FILL' 0" }}
            aria-hidden
          >
            search
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(String((e.target as unknown as { value: string }).value))}
            placeholder="Buscar por título o artista..."
            className="h-9 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            aria-label="Buscar canciones"
          />
        </div>
      </div>
      <div className="space-y-2">
        {filtered.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
              {s.cover_url ? (
                <Image
                  src={s.cover_url}
                  alt={s.title ?? ""}
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
              <p className="truncate font-medium">{s.title}</p>
              <p className="truncate text-sm text-muted-foreground">
                {s.artist_name}
              </p>
            </div>
            <div className="flex gap-1">
              {!s.is_active && (
                <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-600 dark:text-red-400">
                  inactiva
                </span>
              )}
              {s.youtube_verified && (
                <span
                  className="material-symbols-outlined text-lg text-green-500"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                  title="YouTube verificado"
                >
                  check_circle
                </span>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">
            {q.trim()
              ? `No hay resultados para "${q}"`
              : "No hay canciones en el catálogo"}
          </p>
        )}
      </div>
    </div>
  );
}
