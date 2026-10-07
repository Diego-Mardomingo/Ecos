import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Andamiaje común de los route handlers: sesión, errores, parámetros y cabeceras de caché.
 *
 * No es un framework: son funciones sueltas para no copiar en cada ruta el mismo `getUser()`, el
 * mismo 500 y el mismo `parseInt` sin control de `NaN` (que acababa en `LIMIT NULL`, es decir, sin
 * límite). `createServiceClient()` sigue siendo explícito en cada ruta que lo use: aquí no se
 * esconde, porque con él la autorización es responsabilidad de la ruta.
 */

// ---------------------------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------------------------

/**
 * Cliente de cookies y usuario de la petición. Usa `getUser()` (nunca `getSession()`, que es
 * falsificable). `user` es `null` sin sesión.
 */
export async function getRequestUser(): Promise<{
  supabase: SupabaseClient;
  user: User | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// ---------------------------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------------------------

/**
 * Cabecera para respuestas que dependen de la sesión: ni el navegador ni ninguna caché
 * compartida deben guardarlas.
 */
export const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Cabecera para respuestas iguales para todo el mundo, cacheables en la CDN durante `sMaxAge`
 * segundos y servibles caducadas otros `staleWhileRevalidate` mientras se refrescan.
 *
 * **Solo** para rutas que no lean cookies: si un `createClient()` de cookies refrescara la sesión
 * dentro, la respuesta saldría con `Set-Cookie` y se quedaría en la CDN. Esas rutas usan el
 * cliente anónimo de `@/lib/queries/public-client` o el de service role.
 */
export function publicCacheHeaders(
  sMaxAge: number,
  staleWhileRevalidate = 0
): Record<string, string> {
  const parts = ["public", "max-age=0", `s-maxage=${Math.max(0, Math.floor(sMaxAge))}`];
  if (staleWhileRevalidate > 0) {
    parts.push(`stale-while-revalidate=${Math.floor(staleWhileRevalidate)}`);
  }
  return { "Cache-Control": parts.join(", ") };
}

/** Respuesta JSON de error con el formato de siempre (`{ error }`), sin caché. */
export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: PRIVATE_NO_STORE });
}

/** 500 genérico con el error en el log, etiquetado con la ruta. */
export function internalError(scope: string, err: unknown): NextResponse {
  console.error(`${scope} error:`, err);
  return jsonError(500, "Internal server error");
}

/**
 * Envuelve un handler con el try/catch habitual: cualquier excepción acaba en un 500 genérico y
 * en el log con `scope`, sin filtrar el mensaje al cliente.
 */
export function handleRoute<Args extends unknown[]>(
  scope: string,
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return internalError(scope, err);
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------------------------

/**
 * Entero de la query string acotado a `[min, max]`. Si falta o no es un número entero
 * (`abc`, `1.5`, `''`), devuelve `fallback`: nunca `NaN`, que en una RPC llegaba como `null`.
 */
export function parseIntParam(
  raw: string | null,
  { fallback, min, max }: { fallback: number; min: number; max: number }
): number {
  if (raw == null || !/^-?\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  if (!Number.isSafeInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Devuelve `raw` si es uno de los valores permitidos, si no `null`. */
export function parseEnumParam<T extends string>(
  raw: string | null,
  allowed: readonly T[]
): T | null {
  return raw != null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Es un UUID? Los ids de juego lo son; validarlo antes evita mandar a PostgREST un valor que
 * respondería con error de tipo (y que se confundiría con un fallo de la base de datos).
 */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
