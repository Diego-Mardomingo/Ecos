import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Comprueba, en servidor, que la petición proviene de un usuario autenticado con rol admin.
 *
 * IMPORTANTE: las Server Actions se invocan por su action-id mediante un POST que puede
 * dirigirse a cualquier ruta, por lo que NO pasan necesariamente por el guard de `/admin`
 * del middleware. Cada acción/página admin debe llamar a esto por su cuenta (defensa en
 * profundidad, no confiar solo en el middleware).
 *
 * NO usar la RPC `is_admin()` que hay en la base de datos: pese al nombre, consulta
 * `hubgames_usuarios.administrador`, que es de la otra aplicación que comparte el proyecto de
 * Supabase, y no tiene ningún usuario marcado. Para Ecos el rol vive en `ecos_profiles.role`.
 */
export async function requireAdmin(): Promise<{ error: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "unauthorized" };

  const { data: profile } = await supabase
    .from("ecos_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (profile?.role !== "admin") return { error: "forbidden" };
  return null;
}

/**
 * {@link requireAdmin} compartido dentro de un mismo render: cuando el layout de admin y la
 * página se renderizan en la misma petición, la comprobación (`getUser()` + lectura del rol) se
 * hace una vez y no dos. `cache()` vale por petición, así que no mezcla usuarios.
 *
 * Solo para Server Components. Las server actions siguen llamando a `requireAdmin()` sin caché.
 */
const requireAdminForRender = cache(requireAdmin);

/**
 * Igual que {@link requireAdmin} pero para Server Components: corta el render con `notFound()`
 * en vez de devolver un error, para no revelar que la ruta de admin existe.
 *
 * Hay que llamarlo en **cada página** de admin, no solo en el layout: en las navegaciones de
 * cliente Next puede reutilizar el layout ya renderizado y pedir únicamente el RSC de la
 * página, con lo que un guard puesto solo en el layout no se volvería a ejecutar.
 */
export async function requireAdminPage(): Promise<void> {
  const denied = await requireAdminForRender();
  if (denied) notFound();
}
