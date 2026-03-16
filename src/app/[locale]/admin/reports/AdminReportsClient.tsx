"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  markReportCompleted,
  markFeedbackCompleted,
  deleteReport,
  deleteFeedback,
} from "./actions";

const REASON_LABELS: Record<string, string> = {
  bad_audio: "Audio defectuoso",
  wrong_video: "Vídeo incorrecto",
  intro_problem: "Problema con intro",
  explicit_content: "Contenido explícito",
  other: "Otro",
};

const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  bug: "Bug / fallo",
  error: "Error / problema",
  suggestion: "Sugerencia",
};

function getFeedbackBadgeClass(type: string): string {
  switch (type) {
    case "bug":
      return "bg-red-500/20 text-red-600 dark:text-red-400";
    case "error":
      return "bg-amber-500/20 text-amber-600 dark:text-amber-400";
    case "suggestion":
      return "bg-blue-500/20 text-blue-600 dark:text-blue-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export type ReportItem = {
  id: string;
  reason: string;
  description: string | null;
  status: string;
  created_at: string;
  ecos_songs: { title: string; artist_name: string } | null;
};

export type FeedbackItem = {
  id: string;
  type: string;
  message: string;
  email: string | null;
  user_id: string | null;
  status: string;
  created_at: string;
};

type SelectedReport = { kind: "report"; data: ReportItem };
type SelectedFeedback = { kind: "feedback"; data: FeedbackItem };
type SelectedItem = SelectedReport | SelectedFeedback | null;

interface Props {
  reports: ReportItem[];
  feedbackList: FeedbackItem[];
}

export function AdminReportsClient({ reports, feedbackList }: Props) {
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [pending, setPending] = useState(false);

  const handleMarkCompleted = async () => {
    if (!selected) return;
    setPending(true);
    try {
      if (selected.kind === "report") {
        await markReportCompleted(selected.data.id);
      } else {
        await markFeedbackCompleted(selected.data.id);
      }
      setSelected(null);
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || !confirm("¿Eliminar este registro?")) return;
    setPending(true);
    try {
      if (selected.kind === "report") {
        await deleteReport(selected.data.id);
      } else {
        await deleteFeedback(selected.data.id);
      }
      setSelected(null);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="space-y-8">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Reportes de canciones
          </h2>
          <div className="space-y-2">
            {(reports ?? []).map((r) => {
              const song = r.ecos_songs;
              const completed = r.status === "completed";
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelected({ kind: "report", data: r })}
                  className={cn(
                    "w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50",
                    "flex items-start gap-3"
                  )}
                >
                  {completed && (
                    <span
                      className="mt-0.5 shrink-0 text-lg text-green-600 dark:text-green-400"
                      aria-hidden
                    >
                      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                        check_circle
                      </span>
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-xs font-medium",
                          r.status === "pending"
                            ? "bg-amber-500/20 text-amber-600"
                            : "bg-muted text-muted-foreground"
                        )}
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
                </button>
              );
            })}
            {(!reports || reports.length === 0) && (
              <p className="py-8 text-center text-muted-foreground">
                No hay reportes de canciones
              </p>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Feedback (bugs y sugerencias)
          </h2>
          <div className="space-y-2">
            {(feedbackList ?? []).map((f) => {
              const completed = f.status === "completed";
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelected({ kind: "feedback", data: f })}
                  className={cn(
                    "w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50",
                    "flex items-start gap-3"
                  )}
                >
                  {completed && (
                    <span
                      className="mt-0.5 shrink-0 text-lg text-green-600 dark:text-green-400"
                      aria-hidden
                    >
                      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                        check_circle
                      </span>
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={cn("rounded px-2 py-0.5 text-xs font-medium", getFeedbackBadgeClass(f.type))}>
                        {FEEDBACK_TYPE_LABELS[f.type] ?? f.type}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {f.created_at
                          ? new Date(f.created_at).toLocaleString("es")
                          : ""}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{f.message}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0 text-xs text-muted-foreground">
                      {f.email && <span>Email: {f.email}</span>}
                      {f.user_id ? (
                        <span>Con sesión</span>
                      ) : (
                        <span>Sin sesión</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {(!feedbackList || feedbackList.length === 0) && (
              <p className="py-8 text-center text-muted-foreground">
                No hay feedback
              </p>
            )}
          </div>
        </section>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          {selected?.kind === "report" && (
            <>
              <DialogHeader>
                <DialogTitle>Reporte de canción</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-xs font-medium",
                      selected.data.status === "pending"
                        ? "bg-amber-500/20 text-amber-600"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {selected.data.status}
                  </span>
                  <span className="text-muted-foreground">
                    {selected.data.created_at
                      ? new Date(selected.data.created_at).toLocaleString("es")
                      : ""}
                  </span>
                </div>
                <p className="font-medium">
                  {selected.data.ecos_songs
                    ? `${selected.data.ecos_songs.title} · ${selected.data.ecos_songs.artist_name}`
                    : "-"}
                </p>
                <p className="text-muted-foreground">
                  <span className="font-medium">Motivo:</span>{" "}
                  {REASON_LABELS[selected.data.reason] ?? selected.data.reason}
                </p>
                {selected.data.description && (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {selected.data.description}
                  </p>
                )}
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                {selected.data.status !== "completed" && (
                  <Button
                    onClick={handleMarkCompleted}
                    disabled={pending}
                    variant="outline"
                  >
                    {pending ? "…" : "Marcar completado"}
                  </Button>
                )}
                <Button
                  onClick={handleDelete}
                  disabled={pending}
                  variant="destructive"
                >
                  {pending ? "…" : "Eliminar"}
                </Button>
              </DialogFooter>
            </>
          )}
          {selected?.kind === "feedback" && (
            <>
              <DialogHeader>
                <DialogTitle>Feedback</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn("rounded px-2 py-0.5 text-xs font-medium", getFeedbackBadgeClass(selected.data.type))}>
                    {FEEDBACK_TYPE_LABELS[selected.data.type] ?? selected.data.type}
                  </span>
                  <span className="text-muted-foreground">
                    {selected.data.created_at
                      ? new Date(selected.data.created_at).toLocaleString("es")
                      : ""}
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{selected.data.message}</p>
                <div className="flex flex-wrap gap-x-4 text-muted-foreground">
                  {selected.data.email && (
                    <span>Email: {selected.data.email}</span>
                  )}
                  {selected.data.user_id ? (
                    <span>Con sesión</span>
                  ) : (
                    <span>Sin sesión</span>
                  )}
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                {selected.data.status !== "completed" && (
                  <Button
                    onClick={handleMarkCompleted}
                    disabled={pending}
                    variant="outline"
                  >
                    {pending ? "…" : "Marcar completado"}
                  </Button>
                )}
                <Button
                  onClick={handleDelete}
                  disabled={pending}
                  variant="destructive"
                >
                  {pending ? "…" : "Eliminar"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
