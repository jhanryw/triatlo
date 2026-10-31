import { createBrowserClient } from "@supabase/ssr";
import type { SupabasePublicEnv } from "./env";

/**
 * Browser client. Uses only the PUBLIC publishable key; access control is enforced by RLS.
 * The configuration is passed in by a server component (read at runtime), never embedded at build time.
 * Never import a privileged key here.
 */
export function createBrowserSupabaseClient(env: SupabasePublicEnv) {
  return createBrowserClient(env.url, env.publishableKey);
}
