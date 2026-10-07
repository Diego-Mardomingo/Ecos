import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getSafeRedirectTarget,
  LOGIN_REDIRECT_COOKIE,
  LOGIN_REDIRECT_COOKIE_PATH,
} from "@/lib/auth/safeRedirectPath";

/**
 * Vuelta del login con Google (OAuth + PKCE). Canjea el código por la sesión, que escribe las
 * cookies a través de `createClient()`, y redirige al destino que había pedido el login.
 *
 * El destino llega en `?next=` o, en el flujo normal, en la cookie que deja `LoginClient` antes de
 * salir hacia Google (ver `LOGIN_REDIRECT_COOKIE`). Se sanea en los dos casos.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const target =
    getSafeRedirectTarget(searchParams.get("next")) ??
    getSafeRedirectTarget(request.cookies.get(LOGIN_REDIRECT_COOKIE)?.value) ??
    "/";

  let destination = "/login?error=auth_failed";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      destination = target;
    }
  }

  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(LOGIN_REDIRECT_COOKIE, "", {
    path: LOGIN_REDIRECT_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}
