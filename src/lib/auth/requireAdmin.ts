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
 * La regla de quién es admin vive en la RPC `is_admin()` de Postgres, que es la que ya usa la
 * base de datos: aquí no se replica leyendo `ecos_profiles`, para que no haya dos definiciones
 * que puedan divergir.
 *
 * @returns `null` si es admin, o un objeto `{ error }` listo para devolver desde la action.
 */
export async function requireAdmin(): Promise<{ error: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "unauthorized" };

  // `is_admin()` no recibe argumentos: saca el usuario de `auth.uid()`. Por eso tiene que ir con
  // el cliente ligado a cookies y nunca con service role, donde `auth.uid()` es null y siempre
  // devolvería false. Como no acepta un user_id, tampoco se puede usar para suplantar a nadie.
  const { data: isAdmin, error } = await supabase.rpc("is_admin");

  if (error) {
    // Denegar, sin comprobarlo por otra vía: un fallback que leyera `ecos_profiles` a mano podría
    // resultar más permisivo que la función canónica si esta exige algo más que el rol.
    console.error("requireAdmin: fallo al invocar is_admin()", error);
    return { error: "forbidden" };
  }

  if (isAdmin !== true) return { error: "forbidden" };
  return null;
}

/**
 * Igual que {@link requireAdmin} pero para Server Components: corta el render con `notFound()`
 * en vez de devolver un error, para no revelar que la ruta de admin existe.
 *
 * Hay que llamarlo en **cada página** de admin, no solo en el layout: en las navegaciones de
 * cliente Next puede reutilizar el layout ya renderizado y pedir únicamente el RSC de la
 * página, con lo que un guard puesto solo en el layout no se volvería a ejecutar.
 */
export async function requireAdminPage(): Promise<void> {
  const denied = await requireAdmin();
  if (denied) notFound();
}
