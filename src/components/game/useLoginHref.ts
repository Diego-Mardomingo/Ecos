"use client";

import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { localizedPath } from "@/lib/i18n/localizedPath";

/**
 * Enlace a `/login` que vuelve a la pantalla actual al entrar (UX-01): desde una partida de un
 * día pasado se vuelve a esa partida, no a la de hoy ni a la home.
 *
 * El destino lleva el prefijo de idioma (`/en/play/…`), porque el login lo usa tal cual para
 * redirigir; el `Link` de i18n ya pone el prefijo a `/login`. Lo valida el login con
 * `getSafeRedirectTarget`.
 */
export function useLoginHref(): string {
  const locale = useLocale();
  const pathname = usePathname();
  return `/login?redirect=${encodeURIComponent(localizedPath(locale, pathname))}`;
}
