"use client";

import { useCallback, useEffect, useState } from "react";

/** Máximo de veces que se puede cerrar el modal sin activar notificaciones; luego no se vuelve a mostrar. */
export const NOTIFICATIONS_MODAL_MAX_DISMISSES = 3;

interface PushStatusResponse {
  modal_dismiss_count: number;
  enabled: boolean;
  endpoints: string[];
}

interface UseNotificationsReturn {
  /** Soportado por navegador y entorno (HTTPS / SW disponible). */
  isSupported: boolean;
  /** Permiso actual del navegador. */
  permission: NotificationPermission | "unsupported";
  /** Hay una suscripción activa para este usuario en BD. */
  isEnabled: boolean;
  /** Veces que el usuario ha cerrado el modal sin activar (0–3). A 3 no se vuelve a mostrar. */
  modalDismissCount: number;
  /** Ya no quedan intentos de mostrar el modal (≥3 cierres sin activar). */
  modalPromptExhausted: boolean;
  /** Alguna operación en curso (subscribe / unsubscribe / fetch). */
  isLoading: boolean;
  /** El estado real de `isEnabled` ya se cargó desde el servidor (evita animar el toggle al montar). */
  isInitialized: boolean;
  /** Activar notificaciones: pide permiso, suscribe y guarda en BD. */
  enable: () => Promise<boolean>;
  /** Desactivar notificaciones: elimina la suscripción y desactiva en BD. */
  disable: () => Promise<void>;
  /**
   * Registra un cierre del modal sin activar notificaciones (+1 hasta 3).
   * Con `{ exhaust: true }` fija el contador a 3 (p. ej. permiso denegado en el navegador).
   */
  recordModalDismiss: (options?: { exhaust?: boolean }) => Promise<void>;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  const reg = await navigator.serviceWorker.getRegistration("/serwist/sw.js");
  if (reg) return reg;
  return navigator.serviceWorker.ready;
}

/**
 * Hook centralizado para Web Push: estado de suscripción, permisos, y
 * operaciones de alta/baja sincronizadas con la tabla `ecos_push_subscriptions`.
 *
 * Usado tanto por el modal de bienvenida (primera visita) como por el toggle del perfil.
 */
export function useNotifications(options?: {
  /** Si es false, no consulta el estado al montar (útil para usuarios no logueados). */
  enabled?: boolean;
  /**
   * Estado inicial obtenido en SSR (página de perfil). Si se proporciona,
   * el hook arranca ya inicializado y se salta el `GET /api/push/status` al montar.
   */
  initialStatus?: {
    enabled: boolean;
    modalDismissCount: number;
  };
}): UseNotificationsReturn {
  const queryEnabled = options?.enabled ?? true;
  const initialStatus = options?.initialStatus;
  const hasInitialStatus = initialStatus !== undefined;

  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [isEnabled, setIsEnabled] = useState(initialStatus?.enabled ?? false);
  /** Asumir agotado hasta cargar el perfil (evita flash del modal). */
  const [modalDismissCount, setModalDismissCount] = useState(
    initialStatus?.modalDismissCount ?? NOTIFICATIONS_MODAL_MAX_DISMISSES
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(hasInitialStatus);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    setIsSupported(supported);
    setPermission(supported ? Notification.permission : "unsupported");
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!queryEnabled || !isSupported) return;
    try {
      const res = await fetch("/api/push/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as PushStatusResponse;
      setIsEnabled(data.enabled);
      setModalDismissCount(
        Math.min(
          Math.max(0, data.modal_dismiss_count ?? 0),
          NOTIFICATIONS_MODAL_MAX_DISMISSES
        )
      );
    } catch (err) {
      console.error("useNotifications: refreshStatus failed", err);
    } finally {
      setIsInitialized(true);
    }
  }, [queryEnabled, isSupported]);

  useEffect(() => {
    if (hasInitialStatus) return;
    void refreshStatus();
  }, [hasInitialStatus, refreshStatus]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      console.error("useNotifications: NEXT_PUBLIC_VAPID_PUBLIC_KEY no definido");
      return false;
    }

    setIsLoading(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        return false;
      }

      const registration = await getRegistration();
      if (!registration) {
        console.error("useNotifications: no service worker registration");
        return false;
      }

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!res.ok) {
        console.error("useNotifications: subscribe API failed");
        await subscription.unsubscribe().catch(() => undefined);
        return false;
      }

      setIsEnabled(true);
      return true;
    } catch (err) {
      console.error("useNotifications.enable error:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  const disable = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);
    try {
      const registration = await getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      const endpoint = subscription?.endpoint;

      if (subscription) {
        await subscription.unsubscribe().catch(() => undefined);
      }

      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(endpoint ? { endpoint } : {}),
      }).catch(() => undefined);

      setIsEnabled(false);
    } catch (err) {
      console.error("useNotifications.disable error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  const recordModalDismiss = useCallback(
    async (options?: { exhaust?: boolean }) => {
      const exhaust = options?.exhaust === true;
      if (exhaust) {
        setModalDismissCount(NOTIFICATIONS_MODAL_MAX_DISMISSES);
      } else {
        setModalDismissCount((c) =>
          Math.min(c + 1, NOTIFICATIONS_MODAL_MAX_DISMISSES)
        );
      }
      try {
        const res = await fetch("/api/push/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(exhaust ? { exhaust: true } : {}),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            notifications_modal_dismiss_count?: number;
          };
          if (typeof data.notifications_modal_dismiss_count === "number") {
            setModalDismissCount(
              Math.min(
                data.notifications_modal_dismiss_count,
                NOTIFICATIONS_MODAL_MAX_DISMISSES
              )
            );
          }
        }
      } catch (err) {
        console.error("useNotifications.recordModalDismiss error:", err);
      }
    },
    []
  );

  const modalPromptExhausted =
    modalDismissCount >= NOTIFICATIONS_MODAL_MAX_DISMISSES;

  return {
    isSupported,
    permission,
    isEnabled,
    modalDismissCount,
    modalPromptExhausted,
    isLoading,
    isInitialized,
    enable,
    disable,
    recordModalDismiss,
  };
}
