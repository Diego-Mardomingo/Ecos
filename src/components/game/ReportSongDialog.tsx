"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useReportGameMutation, type ReportGameInput } from "@/lib/hooks/queries";
import { cn } from "@/lib/utils";

/**
 * Diálogo para reportar un problema con la canción de un reto. Solo para usuarios con sesión
 * (`/api/report` la exige).
 *
 * Estaba dentro de la pantalla de resultado; vive aparte para poder ofrecerlo también durante la
 * partida cuando el audio no carga (UX-06), que es justo cuando más falta hace.
 *
 * El motivo «el vídeo no corresponde a la canción» ya no está: el vídeo de YouTube se retiró hace
 * tiempo (UX-15, DEAD-20).
 */

const REPORT_REASON_KEYS: Record<ReportGameInput["reason"], string> = {
  bad_audio: "report.reasonBadAudio",
  intro_problem: "report.reasonIntroProblem",
  explicit_content: "report.reasonExplicit",
  other: "report.reasonOther",
};
const REPORT_REASON_IDS = Object.keys(REPORT_REASON_KEYS) as ReportGameInput["reason"][];

export function ReportSongDialog({
  gameId,
  songId,
  trigger,
}: {
  gameId: string;
  songId: string;
  /** Botón que abre el diálogo. */
  trigger: ReactNode;
}) {
  const t = useTranslations("game");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportGameInput["reason"] | "">("");
  const [description, setDescription] = useState("");
  const descriptionId = useId();
  const [sent, setSent] = useState(false);
  const reportMutation = useReportGameMutation();

  const handleReport = () => {
    if (!reason) return;
    reportMutation.mutate(
      {
        gameId,
        songId,
        reason,
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setSent(true);
          setOpen(false);
        },
        onError: () => {
          toast.error(tc("error"));
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("report.dialogTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("report.reportProblemWithSong")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {sent ? (
            <p className="text-sm text-muted-foreground">{t("report.thankYou")}</p>
          ) : (
            <>
              {/* fieldset/legend en vez de un <p> suelto: asi el lector de pantalla
                  sabe a que pregunta responde cada radio. El etiquetado de cada opcion
                  ya era correcto, porque el <label> envuelve al input. */}
              <fieldset>
                <legend className="mb-2 text-sm font-medium">{t("report.reasonLabel")}</legend>
                <div className="space-y-2">
                  {REPORT_REASON_IDS.map((id) => (
                    <label
                      key={id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors",
                        reason === id ? "border-brand/50 bg-brand/8" : "border-border hover:bg-muted/60"
                      )}
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={id}
                        checked={reason === id}
                        onChange={() => setReason(id)}
                        className="h-4 w-4 accent-[var(--brand)]"
                      />
                      <span className="text-sm">{t(REPORT_REASON_KEYS[id])}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {reason === "other" && (
                <div>
                  {/* El label no tenia htmlFor ni el textarea id, asi que no estaban
                      asociados: el campo se anunciaba sin nombre. */}
                  <label htmlFor={descriptionId} className="mb-1 block text-sm font-medium">
                    {t("report.descriptionLabel")}
                  </label>
                  <textarea
                    id={descriptionId}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("report.descriptionPlaceholder")}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    rows={3}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={handleReport}
                disabled={!reason || reportMutation.isPending}
                className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {reportMutation.isPending ? t("report.sending") : t("report.submit")}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Botón discreto que abre el diálogo, con el mismo aspecto en partida y en resultado. */
export function ReportSongTrigger({ className, ...props }: React.ComponentProps<"button">) {
  const t = useTranslations("game");
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
      {...props}
    >
      <span aria-hidden className="material-symbols-outlined text-base">flag</span>
      {t("report.reportProblemWithSong")}
    </button>
  );
}
