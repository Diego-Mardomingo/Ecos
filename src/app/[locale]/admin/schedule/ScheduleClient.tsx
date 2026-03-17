"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type GameRow = {
  id: string;
  date: string;
  game_number: number;
  ecos_songs: { title: string; artist_name: string; spotify_playlist_name?: string | null } | null;
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ScheduleClient({
  games,
}: {
  games: GameRow[];
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: GameRow[] }>();
    for (const g of games) {
      const dt = new Date(g.date);
      const key = monthKey(dt);
      const label = format(dt, "MMMM yyyy", { locale: es });
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(g);
    }
    return Array.from(map.entries()).map(([key, val]) => ({
      key,
      label: val.label,
      items: val.items,
    }));
  }, [games]);

  const newestKey = groups[0]?.key ?? null; // vienen ya ordenados desc por date
  const [open, setOpen] = useState<Record<string, boolean>>(
    newestKey ? { [newestKey]: true } : {}
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Programación
        </h2>
        <Badge variant="secondary">{games.length}</Badge>
      </div>

      {groups.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          No hay días programados
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = open[g.key] ?? (g.key === newestKey);
            return (
              <Collapsible
                key={g.key}
                open={isOpen}
                onOpenChange={(v) =>
                  setOpen((cur) => ({ ...cur, [g.key]: Boolean(v) }))
                }
              >
                <Card className="gap-3 py-3">
                  <CardContent className="px-3">
                    <div className="flex items-center justify-between gap-3">
                      <CollapsibleTrigger className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md py-1 text-left hover:bg-muted/30">
                        <span className="truncate font-medium capitalize">
                          {g.label}
                        </span>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{g.items.length} juegos</Badge>
                          <span
                            className="material-symbols-outlined text-base text-muted-foreground"
                            style={{ fontVariationSettings: "'FILL' 0" }}
                            aria-hidden
                          >
                            {isOpen ? "expand_less" : "expand_more"}
                          </span>
                        </div>
                      </CollapsibleTrigger>
                    </div>

                    <CollapsibleContent>
                      <div className="mt-2 space-y-2">
                        {g.items.map((it) => (
                          <div
                            key={it.id}
                            className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="font-medium">
                                {format(new Date(it.date), "EEEE d MMM", {
                                  locale: es,
                                })}
                              </p>
                              <p className="truncate text-sm text-muted-foreground">
                                Ecos #{it.game_number}
                                {it.ecos_songs
                                  ? ` — ${it.ecos_songs.title} · ${it.ecos_songs.artist_name}`
                                  : ""}
                              </p>
                              {it.ecos_songs?.spotify_playlist_name ? (
                                <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                                  Playlist: {it.ecos_songs.spotify_playlist_name}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </CardContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}

