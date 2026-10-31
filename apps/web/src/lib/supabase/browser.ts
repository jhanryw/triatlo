import { createBrowserClient } from "@supabase/ssr";
import { SupabaseNotConfiguredError, readSupabaseEnv } from "./env";

/**
 * Browser client. Uses only the PUBLIC publishable key; access control is enforced by RLS
 * (Delivery 2). Never import a privileged key here.
 */
export function createBrowserSupabaseClient() {
  const env = readSupabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  return createBrowserClient(env.url, env.publishableKey);
}
