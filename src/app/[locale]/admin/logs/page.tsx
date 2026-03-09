import { createServiceClient } from "@/lib/supabase/server";

const JOB_LABELS: Record<string, string> = {
  ingestion: "Ingesta",
  cron_daily: "Programación diaria",
  verify_youtube: "Verificación YouTube",
  report_auto_deactivate: "Desactivación por reportes",
};

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
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 hover:bg-muted/30">
              <div className="flex items-center gap-3">
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
                <span className="text-sm text-muted-foreground">
                  {JOB_LABELS[log.job_type] ?? log.job_type}
                </span>
                <span className="text-sm">{log.summary ?? "-"}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {log.duration_ms != null && (
                  <span>{log.duration_ms}ms</span>
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
