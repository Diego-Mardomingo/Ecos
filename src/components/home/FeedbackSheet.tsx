"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useSubmitFeedbackMutation } from "@/lib/hooks/queries";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";

/**
 * Hoja de feedback: reportar un bug o un error, o proponer una mejora.
 *
 * El tipo se elige con tres tarjetas en lugar de un desplegable (en móvil, un `<select>` abre un
 * selector del sistema que tapa la hoja). Al enviar, el formulario se sustituye por la
 * confirmación, desde la que se puede mandar otro.
 */

type FeedbackType = "bug" | "error" | "suggestion";

const MAX_MESSAGE = 2000;

/** Tras cerrar, esperar a que acabe la animación antes de volver al formulario vacío. */
const RESET_AFTER_CLOSE_MS = 350;

const TYPES: Array<{ value: FeedbackType; icon: string; labelKey: string; hintKey: string }> = [
  { value: "bug", icon: "bug_report", labelKey: "reportTypeLabelBug", hintKey: "reportTypeBug" },
  { value: "error", icon: "error", labelKey: "reportTypeLabelError", hintKey: "reportTypeError" },
  { value: "suggestion", icon: "lightbulb", labelKey: "reportTypeLabelSuggestion", hintKey: "reportTypeSuggestion" },
];

export function FeedbackSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const submitFeedback = useSubmitFeedbackMutation();
  const typeGroupId = useId();
  const messageId = useId();
  const emailId = useId();

  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (resetTimeoutRef.current !== null) {
        clearTimeout(resetTimeoutRef.current);
        resetTimeoutRef.current = null;
      }
      onOpenChange(next);
      // Al cerrar tras un envío correcto, volver al formulario cuando la hoja ya no se ve.
      if (!next) {
        resetTimeoutRef.current = setTimeout(() => {
          resetTimeoutRef.current = null;
          setStatus((s) => (s === "success" ? "idle" : s));
        }, RESET_AFTER_CLOSE_MS);
      }
    },
    [onOpenChange]
  );

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) clearTimeout(resetTimeoutRef.current);
    };
  }, []);

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && !submitFeedback.isPending;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    setStatus("idle");
    submitFeedback.mutate(
      { type, message: trimmed, email: email.trim() || undefined },
      {
        onSuccess: () => {
          setStatus("success");
          setMessage("");
          setEmail("");
        },
        onError: () => setStatus("error"),
      }
    );
  };

  const success = status === "success";

  return (
    <BottomSheet
      open={open}
      onOpenChange={handleOpenChange}
      title={t("reportTitle")}
      // La descripción es larga: va en el cuerpo, que desplaza, y no en la cabecera, que es la zona
      // de arrastre de la hoja. Aquí queda solo para el lector de pantalla.
      description={t("reportDescription")}
      hideDescription
      footer={
        success ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setStatus("idle")}
              className="flex h-[52px] items-center justify-center rounded-2xl border border-border bg-muted text-[15px] font-semibold transition-transform active:scale-[0.97]"
            >
              {t("reportAnother")}
            </button>
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="flex h-[52px] items-center justify-center rounded-2xl bg-brand text-[15px] font-bold text-primary-foreground transition-transform active:scale-[0.97]"
            >
              {tc("close")}
            </button>
          </div>
        ) : (
          <motion.button
            type="submit"
            form={`${typeGroupId}-form`}
            disabled={!canSend}
            whileTap={canSend ? { scale: 0.97 } : undefined}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-bold text-primary-foreground shadow-[0_12px_30px_-14px_var(--brand)] transition-opacity disabled:opacity-45 disabled:shadow-none"
          >
            {submitFeedback.isPending ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <span aria-hidden className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                send
              </span>
            )}
            {submitFeedback.isPending ? t("reportSending") : t("reportSubmit")}
          </motion.button>
        )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {success ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 360, damping: 26 }}
            className="flex flex-col items-center py-8 text-center"
            role="status"
          >
            <span className="relative grid size-20 place-items-center">
              <span aria-hidden className="ecos-ping absolute inset-0 rounded-full bg-brand/30 [animation-iteration-count:2]" />
              <motion.span
                initial={{ scale: 0, rotate: -40 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.1, type: "spring", stiffness: 420, damping: 16 }}
                className="relative grid size-20 place-items-center rounded-full bg-brand text-primary-foreground shadow-[0_14px_36px_-12px_var(--brand)]"
              >
                <span aria-hidden className="material-symbols-outlined text-[44px]" style={{ fontVariationSettings: "'wght' 700" }}>
                  check
                </span>
              </motion.span>
            </span>
            <p className="mt-5 font-display text-xl font-bold tracking-[-0.02em]">{t("reportSuccess")}</p>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            id={`${typeGroupId}-form`}
            onSubmit={handleSubmit}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-5 pt-1"
          >
            <p aria-hidden className="rounded-2xl bg-muted/60 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
              {t("reportDescription")}
            </p>
            {/* Tipo */}
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t("reportType")}
              </legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup">
                {TYPES.map((option) => {
                  const active = option.value === type;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={t(option.hintKey)}
                      onClick={() => setType(option.value)}
                      className={cn(
                        "relative flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-[13px] font-semibold transition-colors duration-200 active:scale-[0.97]",
                        active ? "border-brand/50 text-foreground" : "border-border bg-background/50 text-muted-foreground"
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId={`${typeGroupId}-active`}
                          aria-hidden
                          className="absolute inset-0 rounded-2xl bg-brand/10"
                          transition={{ type: "spring", stiffness: 500, damping: 36 }}
                        />
                      )}
                      <motion.span
                        aria-hidden
                        animate={active ? { scale: [1, 1.25, 1], rotate: [0, -10, 0] } : { scale: 1 }}
                        transition={{ duration: 0.35 }}
                        className={cn("material-symbols-outlined relative text-2xl", active && "text-brand")}
                        style={{ fontVariationSettings: `'FILL' ${active ? 1 : 0}` }}
                      >
                        {option.icon}
                      </motion.span>
                      <span className="relative">{t(option.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Mensaje */}
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <label htmlFor={messageId} className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {t("reportMessage")}
                </label>
                <span className={cn("font-mono text-[11px] tabular-nums", message.length > MAX_MESSAGE * 0.9 ? "text-amber-500" : "text-muted-foreground")}>
                  {t("reportCharCount", { count: message.length, max: MAX_MESSAGE })}
                </span>
              </div>
              <textarea
                id={messageId}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("reportMessagePlaceholder")}
                required
                rows={4}
                maxLength={MAX_MESSAGE}
                className="block min-h-[112px] w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-brand/60 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand)_14%,transparent)]"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor={emailId} className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t("reportEmail")}
              </label>
              <div className="relative">
                <span aria-hidden className="material-symbols-outlined pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-muted-foreground">
                  mail
                </span>
                <input
                  id={emailId}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("reportEmailPlaceholder")}
                  className="h-12 w-full rounded-2xl border border-border bg-background pl-11 pr-4 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-brand/60 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand)_14%,transparent)]"
                />
              </div>
            </div>

            <AnimatePresence>
              {status === "error" && (
                <motion.p
                  role="alert"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
                >
                  <span aria-hidden className="material-symbols-outlined text-lg">error</span>
                  {t("reportError")}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.form>
        )}
      </AnimatePresence>
    </BottomSheet>
  );
}
