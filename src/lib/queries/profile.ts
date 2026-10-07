import type { User } from "@supabase/supabase-js";

/**
 * Vista del perfil del usuario: lo que se lee de `ecos_profiles` mezclado con lo que trae la
 * sesión de Google. Estaba construido a mano en cuatro sitios (`/profile`, `/profile/edit`,
 * `GET /api/profile` y `GET /api/profile/core`) con la misma cadena de `??` (DUP-13).
 */

/** Columnas de `ecos_profiles` que necesita {@link buildProfileView}. */
export const PROFILE_VIEW_COLUMNS =
  "display_name, avatar_url, role, username, show_avatar_in_rankings";

/** Fila de `ecos_profiles` tal como llega de PostgREST (todo opcional: puede no existir la fila). */
export interface ProfileDbRow {
  display_name?: string | null;
  avatar_url?: string | null;
  role?: string | null;
  username?: string | null;
  show_avatar_in_rankings?: boolean | null;
  notifications_modal_dismiss_count?: number | null;
}

export interface ProfileView {
  id: string;
  display_name: string;
  avatar_url: string;
  show_avatar_in_rankings: boolean;
  created_at: string;
  email: string;
  role: string | null;
}

/**
 * Nombre: el que eligió el usuario, si no el de la fila, si no el de Google. Avatar: el subido, si
 * no el de Google. `db` es `null` si todavía no existe la fila.
 */
export function buildProfileView(user: User, db: ProfileDbRow | null): ProfileView {
  return {
    id: user.id,
    display_name:
      db?.username ??
      db?.display_name ??
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      "Usuario",
    avatar_url:
      db?.avatar_url ??
      user.user_metadata?.avatar_url ??
      user.user_metadata?.picture ??
      "",
    show_avatar_in_rankings: db?.show_avatar_in_rankings ?? true,
    created_at: user.created_at,
    email: user.email ?? "",
    role: db?.role ?? null,
  };
}

/**
 * Estado de las notificaciones del usuario: si tiene alguna suscripción push activa y cuántas
 * veces ha cerrado el aviso sin activarlas. Lo usan `/profile` y `GET /api/push/status`.
 */
export function summarizeNotifications(
  subscriptions: ReadonlyArray<{ enabled?: boolean | null }> | null,
  dismissCount: number | null | undefined
): { enabled: boolean; modalDismissCount: number } {
  return {
    enabled: (subscriptions ?? []).some((s) => s.enabled),
    modalDismissCount: dismissCount ?? 0,
  };
}
