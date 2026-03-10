import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const JOB_LABELS: Record<string, string> = {
  ingestion: "Ingesta",
  weekly_games: "Juegos semanales",
  daily_game: "Juego diario",
  verify_youtube: "Verificación YouTube",
  report_auto_deactivate: "Desactivación por reportes",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} h`);
  if (m > 0) parts.push(`${m} min`);
  parts.push(`${s} s`);
  return parts.join(" ");
}

const INGESTION_LABELS: Record<string, string> = {
  playlists_checked: "Playlists",
  tracks_found: "Encontradas",
  duplicates: "Duplicadas",
  no_youtube: "Sin YT",
  songs_added: "Insertadas",
};

const WEEKLY_GAMES_LABELS: Record<string, string> = {
  games_created: "Juegos",
  days: "Días",
  target_dates: "Fechas",
};

const DAILY_GAME_LABELS: Record<string, string> = {
  target_date: "Fecha",
  game_number: "Número",
  title: "Título",
  artist: "Artista",
};

function JobDetailsSummary({
  details,
  labels,
}: {
  details: Record<string, unknown> | null;
  labels: Record<string, string>;
}) {
  if (!details || typeof details !== "object") return null;
  const stats = Object.entries(labels)
    .map(([key, label]) => {
      const val = details[key];
      if (val == null || (typeof val === "object" && !Array.isArray(val))) return null;
      if (Array.isArray(val)) return `${label}: ${val.length}`;
      return `${label}: ${val}`;
    })
    .filter(Boolean);
  if (stats.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {stats.join(" · ")}
    </p>
  );
}

export default async function AdminLogsPage() {
  const supabase = await createServiceClient();

  const { data: logs } = await supabase
    .from("ecos_system_logs")
    .select("*")
    .order("ran_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Logs del sistema
      </h2>
      <div className="space-y-2">
        {(logs ?? []).map((log) => (
          <details
            key={log.id}
            className="rounded-xl bg-card overflow-hidden"
          >
            <summary className="flex cursor-pointer flex-col gap-1 px-4 py-3 hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1 space-y-0">
                <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                    log.status === "success"
                      ? "bg-green-500/20 text-green-600 dark:text-green-400"
                      : log.status === "partial"
                        ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                        : "bg-red-500/20 text-red-600 dark:text-red-400"
                  }`}
                >
                  {log.status}
                </span>
                <span
                  className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                    log.job_type === "ingestion"
                      ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                      : log.job_type === "weekly_games"
                        ? "bg-violet-500/20 text-violet-600 dark:text-violet-400"
                        : log.job_type === "verify_youtube"
                          ? "bg-rose-500/20 text-rose-600 dark:text-rose-400"
                          : log.job_type === "report_auto_deactivate"
                            ? "bg-slate-500/20 text-slate-600 dark:text-slate-400"
                            : log.job_type === "daily_game"
                              ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                              : "bg-muted text-muted-foreground"
                  }`}
                >
                  {JOB_LABELS[log.job_type] ?? log.job_type}
                </span>
                <span className="text-sm">{log.summary ?? "-"}</span>
                </div>
                {log.job_type === "ingestion" && (
                  <JobDetailsSummary
                    details={log.details as Record<string, unknown>}
                    labels={INGESTION_LABELS}
                  />
                )}
                {log.job_type === "weekly_games" && (
                  <JobDetailsSummary
                    details={log.details as Record<string, unknown>}
                    labels={WEEKLY_GAMES_LABELS}
                  />
                )}
                {log.job_type === "daily_game" && (
                  <JobDetailsSummary
                    details={log.details as Record<string, unknown>}
                    labels={DAILY_GAME_LABELS}
                  />
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground sm:mt-0">
                {log.duration_ms != null && (
                  <span>{formatDuration(log.duration_ms)}</span>
                )}
                <span>
                  {log.ran_at
                    ? new Date(log.ran_at).toLocaleString("es")
                    : ""}
                </span>
                <span
                  className="material-symbols-outlined text-base"
                  style={{ fontVariationSettings: "'FILL' 0" }}
                >
                  expand_more
                </span>
              </div>
            </summary>
            <div className="border-t border-border bg-muted/20 px-4 py-3">
              {log.errors?.length ? (
                <div className="mb-2">
                  <p className="text-xs font-medium text-destructive">Errores:</p>
                  <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">
                    {JSON.stringify(log.errors, null, 2)}
                  </pre>
                </div>
              ) : null}
              <p className="text-xs font-medium text-muted-foreground">
                Details:
              </p>
              <pre className="mt-1 overflow-x-auto text-xs">
                {JSON.stringify(log.details ?? {}, null, 2)}
              </pre>
            </div>
          </details>
        ))}
        {(!logs || logs.length === 0) && (
          <p className="py-8 text-center text-muted-foreground">
            No hay logs
          </p>
        )}
      </div>
    </div>
  );
}
