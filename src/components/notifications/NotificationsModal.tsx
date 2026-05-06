"use client";

import { useEffect, useState } from "react";
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
import { useAuthStore } from "@/lib/store/authStore";
import { useNotifications } from "@/lib/hooks/useNotifications";

/**
 * Modal de bienvenida que aparece UNA sola vez por usuario logueado para
 * proponer activar notificaciones push. Una vez cerrado (acepte o no), no
 * vuelve a aparecer; el usuario podrá gestionar el estado desde el toggle del
 * perfil.
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
    modalShown,
    isLoading,
    enable,
    markModalSeen,
  } = useNotifications({ enabled: isAuthenticated });

  const [open, setOpen] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);

  useEffect(() => {
    if (!isSupported) {
      setStatusLoaded(true);
      return;
    }
    if (modalShown) {
      setStatusLoaded(true);
    }
  }, [isSupported, modalShown]);

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || !isSupported) return;
    if (modalShown) return;
    if (permission === "denied") {
      void markModalSeen();
      return;
    }
    const timer = window.setTimeout(() => {
      setOpen(true);
      setStatusLoaded(true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    isAuthLoading,
    isAuthenticated,
    isSupported,
    modalShown,
    permission,
    markModalSeen,
  ]);

  const handleClose = async () => {
    setOpen(false);
    if (!modalShown) {
      await markModalSeen();
    }
  };

  const handleToggle = async (next: boolean) => {
    if (!next) return;
    const success = await enable();
    if (success) {
      toast.success(t("enabledToast"));
      await handleClose();
    } else if (permission === "denied" || Notification.permission === "denied") {
      toast.error(t("permissionDenied"));
      await handleClose();
    }
  };

  if (!statusLoaded && !open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          void handleClose();
        }
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader className="items-center text-center sm:text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-brand/15">
            <span
              className="material-symbols-outlined text-3xl text-brand"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              notifications_active
            </span>
          </div>
          <DialogTitle className="text-xl">{t("modalTitle")}</DialogTitle>
          <DialogDescription className="text-center">
            {t("modalDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5">
          <span
            className="material-symbols-outlined text-xl text-brand"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            notifications
          </span>
          <span className="flex-1 text-sm font-medium">
            {t("modalToggleLabel")}
          </span>
          <ModalToggle
            checked={isEnabled}
            disabled={isLoading}
            onCheckedChange={(next) => void handleToggle(next)}
          />
        </div>

        <DialogFooter className="mt-2 sm:justify-center">
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleClose()}
          >
            {isEnabled ? t("modalDone") : t("modalDismiss")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModalToggle({
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <div className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-brand peer-focus:ring-2 peer-focus:ring-brand/30 peer-disabled:opacity-60" />
      <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-5" />
    </label>
  );
}
