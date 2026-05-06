"use client";

import { useCallback, useEffect, useState } from "react";

interface PushStatusResponse {
  modal_shown: boolean;
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
  /** El usuario ya ha visto el modal de bienvenida. */
  modalShown: boolean;
  /** Alguna operación en curso (subscribe / unsubscribe / fetch). */
  isLoading: boolean;
  /** Activar notificaciones: pide permiso, suscribe y guarda en BD. */
  enable: () => Promise<boolean>;
  /** Desactivar notificaciones: elimina la suscripción y desactiva en BD. */
  disable: () => Promise<void>;
  /** Marca el modal como visto (para que no vuelva a aparecer). */
  markModalSeen: () => Promise<void>;
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
}): UseNotificationsReturn {
  const queryEnabled = options?.enabled ?? true;

  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [isEnabled, setIsEnabled] = useState(false);
  const [modalShown, setModalShown] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

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
      setModalShown(data.modal_shown);
    } catch (err) {
      console.error("useNotifications: refreshStatus failed", err);
    }
  }, [queryEnabled, isSupported]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

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

  const markModalSeen = useCallback(async () => {
    setModalShown(true);
    await fetch("/api/push/status", { method: "POST" }).catch((err) => {
      console.error("useNotifications.markModalSeen error:", err);
    });
  }, []);

  return {
    isSupported,
    permission,
    isEnabled,
    modalShown,
    isLoading,
    enable,
    disable,
    markModalSeen,
  };
}
