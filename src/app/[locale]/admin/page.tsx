import { Suspense } from "react";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { formatAdminDate } from "./_lib/format";
import { HealthSection, ReserveCard, ReserveCardFallback } from "./_lib/Health";
import { LogBadges } from "./_lib/LogBadges";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  await requireAdminPage();

  const supabase = await createServiceClient();

  const [
    { count: songsCount },
    { count: gamesCount },
    { count: reportsCount },
    { count: feedbackCount },
    { data: recentLogs },
  ] = await Promise.all([
    supabase.from("ecos_songs").select("*", { count: "exact", head: true }),
    supabase.from("ecos_games").select("*", { count: "exact", head: true }),
    supabase
      .from("ecos_reports")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("ecos_feedback").select("*", { count: "exact", head: true }),
    supabase
      .from("ecos_system_logs")
      .select("id, job_type, status, summary, ran_at")
      .order("ran_at", { ascending: false })
      .limit(10),
  ]);

  const reportsPending = reportsCount ?? 0;
  const feedbackTotal = feedbackCount ?? 0;
  const reportsAndFeedbackTotal = reportsPending + feedbackTotal;

  const sections = [
    { href: "/admin/catalog", label: "Catálogo", icon: "library_music", value: songsCount ?? 0, detail: null as string | null },
    { href: "/admin/playlists", label: "Playlists", icon: "queue_music", value: null, detail: "Pool para ingesta" },
    { href: "/admin/schedule", label: "Programación", icon: "calendar_month", value: gamesCount ?? 0, detail: null },
    {
      href: "/admin/reports",
      label: "Reportes y feedback",
      icon: "report",
      value: reportsAndFeedbackTotal,
      detail: `${reportsPending} reportes · ${feedbackTotal} feedback`,
    },
    { href: "/admin/logs", label: "Logs del sistema", icon: "terminal", value: null, detail: null },
  ];

  return (
    <div className="space-y-6">
      <HealthSection
        reserve={
          <Suspense fallback={<ReserveCardFallback />}>
            <ReserveCard />
          </Suspense>
        }
      />

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
              <span aria-hidden
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
                {s.detail && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>
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
              className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <LogBadges status={log.status} jobType={log.job_type} />
                  <span className="text-sm">{log.summary ?? "-"}</span>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatAdminDate(log.ran_at)}
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
