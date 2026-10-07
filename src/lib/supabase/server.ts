import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente ligado a las cookies de la petición (respeta RLS).
 *
 * En route handlers y server actions, si `getUser()` refresca la sesión, las cookies nuevas se
 * escriben en la respuesta. En Server Components no se puede escribir cookies y el error se
 * ignora: ahí la sesión ya llega refrescada por `src/proxy.ts`, que pasa las cookies nuevas
 * tanto al navegador como a la propia petición. Si un Server Component refrescara por su cuenta
 * (solo pasa si el token caduca justo entre el proxy y el render), Auth acepta después el
 * refresh token anterior del navegador porque es el padre del vigente, así que no se pierde la
 * sesión.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll desde Server Component — ignorar si no se puede escribir
          }
        },
      },
    }
  );
}

/**
 * Cliente Supabase con service_role que bypassa RLS.
 * Usa createClient de supabase-js (no createServerClient) para evitar que las
 * cookies de sesión sobrescriban la service_role y provoquen bloqueos por RLS.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
