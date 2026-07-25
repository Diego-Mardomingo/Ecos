import { createClient } from "@/lib/supabase/server";

/**
 * Comprueba, en servidor, que la petición proviene de un usuario autenticado con rol admin.
 *
 * IMPORTANTE: las Server Actions se invocan por su action-id mediante un POST que puede
 * dirigirse a cualquier ruta, por lo que NO pasan necesariamente por el guard de `/admin`
 * del middleware. Cada acción/página admin debe llamar a esto por su cuenta (defensa en
 * profundidad, no confiar solo en el middleware).
 *
 * @returns `null` si es admin, o un objeto `{ error }` listo para devolver desde la action.
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
