import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con la anon key y **sin cookies**: lo que vería un visitante sin sesión, con la RLS de
 * siempre.
 *
 * Existe para dos sitios donde el cliente de cookies no sirve:
 * - Dentro de `unstable_cache`, que no deja leer `cookies()`.
 * - En rutas cuya respuesta va a una caché compartida (`Cache-Control: public`): si el cliente de
 *   cookies refrescara la sesión, la respuesta llevaría `Set-Cookie` y la CDN la guardaría.
 *
 * Solo para datos iguales para todo el mundo (catálogo, ranking, resúmenes). Para lo que dependa
 * del usuario, el cliente de cookies de `@/lib/supabase/server`.
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
