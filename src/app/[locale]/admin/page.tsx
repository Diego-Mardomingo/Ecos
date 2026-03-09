import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function AdminDashboardPage() {
  const supabase = await createServiceClient();

  const [
    { count: songsCount },
    { count: gamesCount },
    { count: reportsCount },
    { data: recentLogs },
  ] = await Promise.all([
    supabase.from("ecos_songs").select("*", { count: "exact", head: true }),
    supabase.from("ecos_games").select("*", { count: "exact", head: true }),
    supabase
      .from("ecos_reports")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("ecos_system_logs")
      .select("id, job_type, status, summary, ran_at")
      .order("ran_at", { ascending: false })
      .limit(10),
  ]);

  const sections = [
    { href: "/admin/catalog", label: "Catálogo", icon: "library_music", value: songsCount ?? 0 },
    { href: "/admin/schedule", label: "Programación", icon: "calendar_month", value: gamesCount ?? 0 },
    { href: "/admin/reports", label: "Reportes pendientes", icon: "report", value: reportsCount ?? 0 },
    { href: "/admin/logs", label: "Logs del sistema", icon: "terminal", value: null },
  ];

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Métricas
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <span
                className="material-symbols-outlined text-2xl text-brand"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {s.icon}
              </span>
              <div>
                <p className="font-medium">{s.label}</p>
                {s.value !== null && (
                  <p className="text-2xl font-bold">{s.value.toLocaleString()}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Últimos logs
          </h2>
          <Link
            href="/admin/logs"
            className="text-sm font-medium text-brand hover:underline"
          >
            Ver todos
          </Link>
        </div>
        <div className="space-y-2">
          {(recentLogs ?? []).map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
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
                <span className="ml-2 text-xs text-muted-foreground">
                  {log.job_type}
                </span>
                <p className="mt-0.5 text-sm">{log.summary ?? "-"}</p>
              </div>
              <span className="text-xs text-muted-foreground">
                {log.ran_at
                  ? new Date(log.ran_at).toLocaleString("es", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : ""}
              </span>
            </div>
          ))}
          {(!recentLogs || recentLogs.length === 0) && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay logs aún
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
