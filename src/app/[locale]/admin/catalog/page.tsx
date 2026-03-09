import { createServiceClient } from "@/lib/supabase/server";
import Image from "next/image";

export default async function AdminCatalogPage() {
  const supabase = await createServiceClient();

  const { data: songs } = await supabase
    .from("ecos_songs")
    .select("id, title, artist_name, cover_url, is_active, youtube_verified")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Catálogo (últimas 100)
      </h2>
      <div className="space-y-2">
        {(songs ?? []).map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
              {s.cover_url ? (
                <Image
                  src={s.cover_url}
                  alt={s.title}
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
        {(!songs || songs.length === 0) && (
          <p className="py-8 text-center text-muted-foreground">
            No hay canciones en el catálogo
          </p>
        )}
      </div>
    </div>
  );
}
