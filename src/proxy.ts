import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { matchesLocalizedRoute } from "./i18n/locale-path";

const intlMiddleware = createIntlMiddleware(routing);

const protectedRoutes = ["/profile"];

/** Prefijo /en para login y complete cuando la ruta actual es en inglés (as-needed). */
function enPrefixedPath(pathname: string, path: string): string {
  return pathname.startsWith("/en/") ? `/en${path}` : path;
}

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Lo que el refresco de la sesión pide escribir. Va a dos sitios:
  // - A la petición, para que los Server Components de esta misma petición lean ya el token
  //   nuevo. Si leyeran el viejo, `getUser()` volvería a refrescar con un refresh token que
  //   este proxy acaba de gastar, y lo que obtuvieran no se podría guardar (un Server Component
  //   no puede escribir cookies).
  // - A la respuesta que se devuelva al final, sea cual sea: también las redirecciones y el
  //   404 de /admin. Si no, el navegador se queda con el token gastado.
  const cookiesToSet: CookieToSet[] = [];
  let cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // `headers` (Cache-Control: no-store…) lo pasa @supabase/ssr 0.12; la 0.9 no. Una
        // respuesta con cookies de sesión no debe quedarse en ninguna caché compartida.
        setAll(cookies, headers?: Record<string, string>) {
          for (const cookie of cookies) {
            if (cookie.value) request.cookies.set(cookie.name, cookie.value);
            else request.cookies.delete(cookie.name);
            cookiesToSet.push(cookie);
          }
          if (headers) cacheHeaders = { ...cacheHeaders, ...headers };
        },
      },
    }
  );

  const withSession = (response: NextResponse): NextResponse => {
    for (const { name, value, options } of cookiesToSet) {
      response.cookies.set(name, value, options);
    }
    for (const [key, value] of Object.entries(cacheHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdminPath = matchesLocalizedRoute(pathname, "/admin");
  if (isAdminPath) {
    if (!user) {
      return withSession(new NextResponse(null, { status: 404 }));
    }
    // Mismo criterio que requireAdmin(): el rol de Ecos vive en ecos_profiles.role. No usar la
    // RPC is_admin(), que consulta la tabla de la otra aplicación (ver requireAdmin.ts).
    // Esto es solo conveniencia de routing; la autorización real la hace cada página y cada
    // server action por su cuenta.
    const { data: profile } = await supabase
      .from("ecos_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (profile?.role !== "admin") {
      return withSession(new NextResponse(null, { status: 404 }));
    }
  }

  const isProtected = protectedRoutes.some((route) =>
    matchesLocalizedRoute(pathname, route)
  );
  if (isProtected && !user) {
    const loginUrl = new URL(enPrefixedPath(pathname, "/login"), request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return withSession(NextResponse.redirect(loginUrl));
  }

  const isCompleteProfilePath = matchesLocalizedRoute(pathname, "/profile/complete");
  if (user && isProtected && !isCompleteProfilePath) {
    const { data: profile } = await supabase
      .from("ecos_profiles")
      .select("username")
      .eq("user_id", user.id)
      .single();
    if (!profile?.username?.trim()) {
      const completeUrl = new URL(
        enPrefixedPath(pathname, "/profile/complete"),
        request.url
      );
      completeUrl.searchParams.set("redirect", pathname);
      return withSession(NextResponse.redirect(completeUrl));
    }
  }

  // next-intl va después de getUser() a propósito: copia las cabeceras de la petición al crear
  // su respuesta, y así esa copia ya lleva las cookies refrescadas.
  return withSession(intlMiddleware(request));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon0.svg|icon1.png|ecos_.*\\.png|web-app-manifest-.*\\.png|manifest.json|serwist|~offline).*)",
  ],
};
