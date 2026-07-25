import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

const protectedRoutes = ["/profile"];

/** Prefijo /en para login y complete cuando la ruta actual es en inglés (as-needed). */
function enPrefixedPath(pathname: string, path: string): string {
  return pathname.startsWith("/en/") ? `/en${path}` : path;
}

/** Quita el prefijo de locale (solo "en" es explícito; "es" es el default sin prefijo). */
function stripLocale(pathname: string): string {
  if (pathname === "/en") return "/";
  if (pathname.startsWith("/en/")) return pathname.slice(3);
  return pathname;
}

/** Coincidencia por segmento: `/admin` o `/admin/...`, no `/songs/admin-tips`. */
function matchesRoute(pathname: string, base: string): boolean {
  const p = stripLocale(pathname);
  return p === base || p.startsWith(`${base}/`);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const intlResponse = intlMiddleware(request);
  const response = intlResponse ?? NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdminPath = matchesRoute(pathname, "/admin");
  if (isAdminPath) {
    if (!user) {
      return new NextResponse(null, { status: 404 });
    }
    // Misma fuente de verdad que requireAdmin(): la RPC is_admin() de Postgres, que deriva el
    // usuario de auth.uid(). Esto es solo conveniencia de routing; la autorización real la hace
    // cada página y cada server action por su cuenta (ver src/lib/auth/requireAdmin.ts).
    const { data: isAdmin, error } = await supabase.rpc("is_admin");
    if (error || isAdmin !== true) {
      return new NextResponse(null, { status: 404 });
    }
  }

  const isProtected = protectedRoutes.some((route) =>
    matchesRoute(pathname, route)
  );
  if (isProtected && !user) {
    const loginUrl = new URL(enPrefixedPath(pathname, "/login"), request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const isCompleteProfilePath = matchesRoute(pathname, "/profile/complete");
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
      return NextResponse.redirect(completeUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon0.svg|icon1.png|ecos_.*\\.png|web-app-manifest-.*\\.png|icons|manifest.json|sw.js|workbox-.*\\.js|serwist|~offline).*)",
  ],
};
