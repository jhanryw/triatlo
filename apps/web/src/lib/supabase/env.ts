import { z } from "zod";

const SupabasePublicEnvSchema = z.object({
  url: z.url(),
  publishableKey: z.string().min(1),
});

export type SupabasePublicEnv = z.infer<typeof SupabasePublicEnvSchema>;

/**
 * Returns the public Supabase settings, or null when not configured.
 * The app must run without Supabase in Delivery 1 (no server is installed yet).
 */
export function parseSupabaseEnv(raw: { url?: string; publishableKey?: string }): SupabasePublicEnv | null {
  const parsed = SupabasePublicEnvSchema.safeParse({
    url: raw.url?.trim() || undefined,
    publishableKey: raw.publishableKey?.trim() || undefined,
  });
  return parsed.success ? parsed.data : null;
}

/** NEXT_PUBLIC_* values are inlined at build time; keep the literal references. */
export function readSupabaseEnv(): SupabasePublicEnv | null {
  return parseSupabaseEnv({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}
