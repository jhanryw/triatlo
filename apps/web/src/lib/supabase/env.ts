import { z } from "zod";
import { firstRuntimeEnv } from "../runtime-env";

const SupabasePublicEnvSchema = z.object({
  url: z.url(),
  publishableKey: z.string().min(1),
});

export type SupabasePublicEnv = z.infer<typeof SupabasePublicEnvSchema>;

export type KeyKind = "publishable" | "legacy_anon" | "legacy_service_role" | "secret" | "unknown";

/**
 * Classifies an API key by its public shape only (prefix / unsigned JWT claims) — never validates or logs it.
 * Used to refuse privileged keys that were pasted into a PUBLIC setting by mistake.
 */
export function classifyKey(key: string): KeyKind {
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  const parts = key.split(".");
  if (parts.length === 3 && key.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as { role?: unknown };
      if (payload.role === "service_role") return "legacy_service_role";
      if (payload.role === "anon") return "legacy_anon";
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}

/**
 * Returns the public Supabase settings, or null when not configured.
 * The app must run without Supabase in Delivery 1 (no server is installed yet).
 */
export function parseSupabaseEnv(raw: { url?: string; publishableKey?: string }): SupabasePublicEnv | null {
  const parsed = SupabasePublicEnvSchema.safeParse({
    url: raw.url?.trim() || undefined,
    publishableKey: raw.publishableKey?.trim() || undefined,
  });
  if (!parsed.success) return null;
  const kind = classifyKey(parsed.data.publishableKey);
  // A privileged key in a public variable would hand full database access to every visitor: refuse it.
  if (kind === "secret" || kind === "legacy_service_role") return null;
  return parsed.data;
}

/**
 * Server-only, read at RUNTIME (see ../runtime-env.ts). Browser code receives the values as props/arguments
 * from a server component, so the build never needs to know them.
 */
export function readSupabaseEnv(): SupabasePublicEnv | null {
  return parseSupabaseEnv({
    url: firstRuntimeEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    publishableKey: firstRuntimeEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"),
  });
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) on the running service (see .env.example).",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}
