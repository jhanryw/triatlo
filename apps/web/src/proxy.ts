import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { inspectRuntimeSupabaseEnv } from "@/lib/supabase/env";

/**
 * Runs before every page: refreshes the Supabase session cookies and sends visitors without a verified session to /login.
 * There is NO sign-up route: the single account is created by the administrator.
 * Public: /login, health probes, PWA assets. API routes under /api/import and /api/push answer 401 themselves.
 */
const PUBLIC = [/^\/login$/, /^\/api\/health/, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//, /^\/icon\.png$/, /^\/apple-icon\.png$/];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC.some((re) => re.test(pathname));
  const { env } = inspectRuntimeSupabaseEnv();
  if (!env) return isPublic ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();

  if (!data.user && !isPublic) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (data.user && pathname === "/login") return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
