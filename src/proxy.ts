import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

const protectedRoutes = ["/profile"];

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

  const isAdminPath = pathname.includes("/admin");
  if (isAdminPath) {
    if (!user) {
      return new NextResponse(null, { status: 404 });
    }
    const { data: profile } = await supabase
      .from("ecos_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (profile?.role !== "admin") {
      return new NextResponse(null, { status: 404 });
    }
  }

  const isProtected = protectedRoutes.some((route) =>
    pathname.includes(route)
  );
  if (isProtected && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon0.svg|icon1.png|ecos_.*\\.png|web-app-manifest-.*\\.png|icons|manifest.json|sw.js|workbox-.*\\.js|serwist|~offline).*)",
  ],
};
