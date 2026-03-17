"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  addSpotifyPlaylist,
  deletePlaylist,
  reorderPlaylists,
  setPlaylistActive,
  setPlaylistMode,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PlaylistRow = {
  id: string;
  spotify_playlist_id: string;
  spotify_playlist_name: string | null;
  source_url: string | null;
  ingest_mode: "default" | "all";
  is_active: boolean;
  created_at: string;
  sort_order?: number | null;
};

function modeLabel(m: "default" | "all") {
  return m === "all" ? "Todas" : "Principales";
}

function modeBadge(m: "default" | "all") {
  if (m === "all") {
    return (
      <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300">
        Todas
      </Badge>
    );
  }
  return (
    <Badge className="bg-violet-500/20 text-violet-700 dark:text-violet-300">
      Principales
    </Badge>
  );
}

function statusBadge(active: boolean) {
  if (active) {
    return (
      <Badge className="bg-green-500/20 text-green-700 dark:text-green-300">
        Activa
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="dark:bg-destructive/40">
      Inactiva
    </Badge>
  );
}

export function PlaylistsClient({ playlists }: { playlists: PlaylistRow[] }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"default" | "all">("default");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [items, setItems] = useState<PlaylistRow[]>(playlists);
  const [mounted, setMounted] = useState(false);

  // Mantener `items` sincronizado con el servidor tras server actions + revalidate.
  useEffect(() => {
    setItems(playlists);
  }, [playlists]);

  // Evitar hydration mismatch de dnd-kit (IDs aria-* difieren server vs client).
  useEffect(() => {
    setMounted(true);
  }, []);

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((p) => p.is_active).length;
    const inactive = total - active;
    const modeAll = items.filter((p) => p.ingest_mode === "all").length;
    const modeDefault = total - modeAll;
    return { total, active, inactive, modeAll, modeDefault };
  }, [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // En móvil: activar al arrastrar (no long-press), para que se sienta natural
    useSensor(TouchSensor, { activationConstraint: { distance: 10 } })
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((p) => {
      const hay = [
        p.spotify_playlist_name ?? "",
        p.spotify_playlist_id ?? "",
        p.source_url ?? "",
        p.ingest_mode,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [items, q]);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((x) => x.id === String(active.id));
    const newIndex = items.findIndex((x) => x.id === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);

    const ids = next.map((x) => x.id);
    startTransition(async () => {
      const res = await reorderPlaylists(ids);
      if ("error" in res && res.error) setError(res.error);
    });

    // Evitar acabar en un scroll "raro": mantener el ítem movido a la vista.
    const movedId = String(active.id);
    requestAnimationFrame(() => {
      const el = document.getElementById(`playlist-card-${movedId}`);
      el?.scrollIntoView({ block: "nearest" });
    });
  }

  function PlaylistCard({ p }: { p: PlaylistRow }) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: p.id });

    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
    };

    return (
      <div ref={setNodeRef} style={style} id={`playlist-card-${p.id}`}>
        <Card
          className={[
            "gap-3 py-3",
            isDragging ? "opacity-80" : null,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <CardContent className="relative space-y-2.5 px-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {p.spotify_playlist_name || "Sin nombre"}
                </p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  ID: {p.spotify_playlist_id}
                </p>
                {p.source_url && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                    {p.source_url}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {statusBadge(p.is_active)}
                {modeBadge(p.ingest_mode)}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  const scrollY = window.scrollY;
                  setItems((cur) =>
                    cur.map((x) =>
                      x.id === p.id ? { ...x, is_active: !x.is_active } : x
                    )
                  );
                  startTransition(async () => {
                    const res = await setPlaylistActive(p.id, !p.is_active);
                    if ("error" in res && res.error) setError(res.error);
                    requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
                  });
                }}
              >
                {p.is_active ? "Desactivar" : "Activar"}
              </Button>

              <Select
                value={p.ingest_mode}
                disabled={isPending}
                onValueChange={(v) => {
                  const next = v as "default" | "all";
                  setError(null);
                  const scrollY = window.scrollY;
                  setItems((cur) =>
                    cur.map((x) => (x.id === p.id ? { ...x, ingest_mode: next } : x))
                  );
                  startTransition(async () => {
                    const res = await setPlaylistMode(p.id, next);
                    if ("error" in res && res.error) setError(res.error);
                    requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
                  });
                }}
              >
                <SelectTrigger size="sm" className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{modeLabel("default")}</SelectItem>
                  <SelectItem value="all">{modeLabel("all")}</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const ok = window.confirm(
                    "¿Eliminar esta playlist del pool? (No borra canciones ya insertadas)"
                  );
                  if (!ok) return;
                  setError(null);
                  const scrollY = window.scrollY;
                  setItems((cur) => cur.filter((x) => x.id !== p.id));
                  startTransition(async () => {
                    const res = await deletePlaylist(p.id);
                    if ("error" in res && res.error) setError(res.error);
                    requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
                  });
                }}
              >
                Eliminar
              </Button>
            </div>

            <button
              type="button"
              className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted/15 text-muted-foreground hover:bg-muted/30 hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
              aria-label="Reordenar playlist"
              title="Reordenar"
              {...attributes}
              {...listeners}
            >
              <span
                className="material-symbols-outlined text-lg leading-none"
                style={{ fontVariationSettings: "'FILL' 0" }}
                aria-hidden
              >
                drag_indicator
              </span>
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Playlists (Spotify)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestiona el pool usado por la ingesta semanal.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <span
            className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 block -translate-y-1/2 text-base leading-none text-muted-foreground"
            style={{ fontVariationSettings: "'FILL' 0" }}
            aria-hidden
          >
            search
          </span>
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(String((e.target as unknown as { value: string }).value))}
            placeholder="Buscar por nombre, ID o URL..."
            className="pl-10"
            aria-label="Buscar playlists"
          />
        </div>
      </div>

      <Card className="gap-3 py-4">
        <CardContent className="px-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Total: {stats.total}</Badge>
            <Badge className="bg-green-500/20 text-green-700 dark:text-green-300">
              Activas: {stats.active}
            </Badge>
            <Badge variant="destructive" className="dark:bg-destructive/40">
              Inactivas: {stats.inactive}
            </Badge>
            <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300">
              Todas: {stats.modeAll}
            </Badge>
            <Badge className="bg-violet-500/20 text-violet-700 dark:text-violet-300">
              Principales: {stats.modeDefault}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Añadir playlist</CardTitle>
          <CardDescription>
            Pega el enlace/URI de Spotify y elige el modo de ingesta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <p className="text-xs font-medium text-muted-foreground">
                Enlace o URI de Spotify
              </p>
              <Input
                value={source}
                onChange={(e) =>
                  setSource(String((e.target as unknown as { value: string }).value))
                }
                placeholder="https://open.spotify.com/playlist/..."
                disabled={isPending}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Nombre (opcional)
              </p>
              <Input
                value={name}
                onChange={(e) =>
                  setName(String((e.target as unknown as { value: string }).value))
                }
                placeholder="Top 50 Spain"
                disabled={isPending}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Modo</p>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as "default" | "all")}
                disabled={isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecciona modo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Solo principales (packs de 5)</SelectItem>
                  <SelectItem value="all">Toda la playlist</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            disabled={isPending || !source.trim()}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await addSpotifyPlaylist({
                  source,
                  name: name.trim() ? name : undefined,
                  ingest_mode: mode,
                });
                if ("error" in res && res.error) {
                  setError(res.error);
                  return;
                }
                setSource("");
                setName("");
                setMode("default");
              });
            }}
          >
            Añadir
          </Button>
        </CardFooter>
      </Card>

      <div className="space-y-2">
        {q.trim() || !mounted ? (
          // En búsqueda, mantenemos una lista estática (sin reordenar) para evitar confusión.
          filtered.map((p) => <PlaylistCard key={p.id} p={p} />)
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            modifiers={[restrictToVerticalAxis]}
            autoScroll={{
              enabled: true,
              threshold: { x: 0.2, y: 0.25 },
              acceleration: 66,
              interval: 3,
            }}
          >
            <SortableContext
              items={items.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2 overflow-x-hidden">
                {items.map((p) => (
                  <PlaylistCard key={p.id} p={p} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {filtered.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">
            {q.trim() ? `No hay resultados para "${q}"` : "No hay playlists en el pool"}
          </p>
        )}
      </div>
    </div>
  );
}

