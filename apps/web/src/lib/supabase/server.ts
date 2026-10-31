import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SupabaseNotConfiguredError, readSupabaseEnv } from "./env";

/**
 * Server-side client bound to the request cookies (Server Components, Server Actions, Route Handlers).
 * Uses the PUBLIC publishable key: it acts as the signed-in user and is subject to RLS.
 * Privileged operations belong to the worker, never to this app.
 */
export async function createServerSupabaseClient() {
  const env = readSupabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  const cookieStore = await cookies();

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. Session refresh happens
          // in Route Handlers/Server Actions once authentication exists (Delivery 2).
        }
      },
    },
  });
}
