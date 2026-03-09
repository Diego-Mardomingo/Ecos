import { createServiceClient } from "@/lib/supabase/server";

const REASON_LABELS: Record<string, string> = {
  bad_audio: "Audio defectuoso",
  wrong_video: "Vídeo incorrecto",
  intro_problem: "Problema con intro",
  explicit_content: "Contenido explícito",
  other: "Otro",
};

export default async function AdminReportsPage() {
  const supabase = await createServiceClient();

  const { data: reports } = await supabase
    .from("ecos_reports")
    .select(
      `
      id, reason, description, status, created_at,
      ecos_songs ( title, artist_name )
    `
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Reportes
      </h2>
      <div className="space-y-2">
        {(reports ?? []).map((r) => {
          const song = (r.ecos_songs as unknown) as
            | { title: string; artist_name: string }
            | null;
          return (
            <div
              key={r.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    r.status === "pending"
                      ? "bg-amber-500/20 text-amber-600"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {r.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.created_at
                    ? new Date(r.created_at).toLocaleString("es")
                    : ""}
                </span>
              </div>
              <p className="mt-2 font-medium">
                {song ? `${song.title} · ${song.artist_name}` : "-"}
              </p>
              <p className="text-sm text-muted-foreground">
                {REASON_LABELS[r.reason] ?? r.reason}
                {r.description && ` — ${r.description}`}
              </p>
            </div>
          );
        })}
        {(!reports || reports.length === 0) && (
          <p className="py-8 text-center text-muted-foreground">
            No hay reportes
          </p>
        )}
      </div>
    </div>
  );
}
