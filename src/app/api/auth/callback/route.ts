import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSafeRedirectTarget } from "@/lib/auth/safeRedirectPath";

/**
 * Vuelta del login con Google (OAuth + PKCE). Canjea el código por la sesión, que escribe las
 * cookies a través de `createClient()`, y redirige al destino de `?next=`, ya saneado.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const target = getSafeRedirectTarget(searchParams.get("next")) ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(target, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
}
