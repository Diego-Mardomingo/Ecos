"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useAuthStore } from "@/lib/store/authStore";
import { useNotifications } from "@/lib/hooks/useNotifications";

/**
 * Modal para proponer activar notificaciones push. Se puede cerrar sin activar
 * hasta 3 veces; después no vuelve a mostrarse mientras las notificaciones
 * sigan desactivadas.
 */
export function NotificationsModal() {
  const user = useAuthStore((s) => s.user);
  const isAuthLoading = useAuthStore((s) => s.loading);
  const isAuthenticated = !!user;

  const t = useTranslations("notifications");
  const {
    isSupported,
    permission,
    isEnabled,
    modalPromptExhausted,
    isLoading,
    enable,
    recordModalDismiss,
  } = useNotifications({ enabled: isAuthenticated });

  const [open, setOpen] = useState(false);
  /** Si true, el próximo cierre del diálogo no incrementa el contador (p. ej. activación correcta). */
  const skipNextDismissIncrement = useRef(false);

  /** Ya sabemos que el modal no toca mostrarse: derivado, no sincronizado por efecto. */
  const statusLoaded = !isSupported || modalPromptExhausted || isEnabled;

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || !isSupported) return;
    if (modalPromptExhausted || isEnabled) return;
    if (permission === "denied") {
      void recordModalDismiss({ exhaust: true });
      return;
    }
    // setOpen basta: el guard de abajo ya deja pasar el render cuando open es true.
    const timer = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(timer);
  }, [
    isAuthLoading,
    isAuthenticated,
    isSupported,
    modalPromptExhausted,
    isEnabled,
    permission,
    recordModalDismiss,
  ]);

  const handleToggle = async (next: boolean) => {
    if (!next) return;
    const success = await enable();
    if (success) {
      skipNextDismissIncrement.current = true;
      toast.success(t("enabledToast"));
      setOpen(false);
    } else if (permission === "denied" || Notification.permission === "denied") {
      toast.error(t("permissionDenied"));
      setOpen(false);
    }
  };

  if (!statusLoaded && !open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          const skip = skipNextDismissIncrement.current;
          skipNextDismissIncrement.current = false;
          if (!skip) {
            void recordModalDismiss();
          }
        }
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-sm overflow-hidden rounded-[28px]">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden">
          <div className="ecos-drift-a absolute -left-10 -top-16 size-48 rounded-full bg-brand/20 blur-3xl" />
          <div className="ecos-drift-b absolute -right-10 -top-10 size-40 rounded-full bg-amber-400/15 blur-3xl" />
        </div>
        <DialogHeader className="relative items-center text-center sm:text-center">
          {/* Campana que se balancea al abrir, como si sonara. */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 18 }}
            className="mb-2 flex size-16 items-center justify-center rounded-3xl bg-brand/15 ring-1 ring-brand/30"
          >
            <motion.span
              aria-hidden
              animate={{ rotate: [0, -18, 15, -10, 6, 0] }}
              transition={{ delay: 0.3, duration: 0.9, ease: "easeInOut" }}
              className="material-symbols-outlined origin-top text-[32px] text-brand"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              notifications_active
            </motion.span>
          </motion.div>
          <DialogTitle className="text-xl">{t("modalTitle")}</DialogTitle>
          <DialogDescription className="text-center">{t("modalDescription")}</DialogDescription>
        </DialogHeader>

        <div className="relative mt-2 flex items-center gap-3 rounded-2xl border border-border bg-background/60 px-4 py-3.5">
          <span
            aria-hidden
            className="material-symbols-outlined text-xl text-brand"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            notifications
          </span>
          <span className="flex-1 text-sm font-medium">{t("modalToggleLabel")}</span>
          <div className="flex shrink-0 items-center gap-2">
            {isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : null}
            <ToggleSwitch
              label={t("modalToggleLabel")}
              checked={isEnabled}
              disabled={isLoading}
              onCheckedChange={(n) => void handleToggle(n)}
            />
          </div>
        </div>

        <DialogFooter className="relative mt-2 sm:justify-center">
          <Button
            type="button"
            variant="ghost"
            className="rounded-full"
            disabled={isLoading}
            onClick={() => setOpen(false)}
          >
            {isEnabled ? t("modalDone") : t("modalDismiss")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
