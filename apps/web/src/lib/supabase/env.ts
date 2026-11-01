import { createHash } from "node:crypto";
import { z } from "zod";
import { firstRuntimeEnv } from "../runtime-env";

const SupabasePublicEnvSchema = z.object({
  url: z.url(),
  publishableKey: z.string().min(1),
});

export type SupabasePublicEnv = z.infer<typeof SupabasePublicEnvSchema>;

export type KeyKind = "publishable" | "legacy_anon" | "legacy_service_role" | "secret" | "demo" | "unknown";

/**
 * SHA-256 of the PUBLIC demonstration API keys shipped in the upstream self-hosting `.env.example`. A deployment that still
 * accepts them uses the public demo JWT secret, so anyone can forge keys. The app refuses to run with them (only hashes
 * are stored here; the keys themselves are not in this repository).
 */
const DEMO_KEY_SHA256 = new Set([
  "fc6a5e9ae75f9160dacd38844789d90a04c85c29c3c95c8c8c6e9da3f58c2365", // demo anon key
  "2359b281e1fa0ec38bb10316e2b0e3a7b960fe5d271ee75a4735ff1b313a222c", // demo service_role key
]);

/**
 * Classifies an API key by its public shape only (prefix / unsigned JWT claims) — never validates or logs it.
 * Used to refuse privileged keys that were pasted into a PUBLIC setting by mistake.
 */
export function classifyKey(key: string): KeyKind {
  if (DEMO_KEY_SHA256.has(createHash("sha256").update(key).digest("hex"))) return "demo";
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

export type SupabaseEnvProblem = "missing" | "invalid_url" | "refused_demo_key" | "refused_privileged_key";

export interface SupabaseEnvInspection {
  env: SupabasePublicEnv | null;
  /** Why `env` is null (never contains values). */
  problem: SupabaseEnvProblem | null;
}

/**
 * Validates the public Supabase settings and says WHY they were refused.
 * The app must run without Supabase (nothing is installed yet in some environments), but it must never run with:
 * - a privileged key in a public variable (full database access for every visitor);
 * - the public upstream DEMO keys (anyone can forge credentials for such an instance).
 */
export function inspectSupabaseEnv(raw: { url?: string; publishableKey?: string }): SupabaseEnvInspection {
  const url = raw.url?.trim();
  const key = raw.publishableKey?.trim();
  if (!url || !key) return { env: null, problem: "missing" };
  const parsed = SupabasePublicEnvSchema.safeParse({ url, publishableKey: key });
  if (!parsed.success) return { env: null, problem: "invalid_url" };
  const kind = classifyKey(parsed.data.publishableKey);
  if (kind === "demo") return { env: null, problem: "refused_demo_key" };
  if (kind === "secret" || kind === "legacy_service_role") return { env: null, problem: "refused_privileged_key" };
  return { env: parsed.data, problem: null };
}

/** Returns the public Supabase settings, or null when absent or refused (see inspectSupabaseEnv). */
export function parseSupabaseEnv(raw: { url?: string; publishableKey?: string }): SupabasePublicEnv | null {
  return inspectSupabaseEnv(raw).env;
}

/**
 * Server-only, read at RUNTIME (see ../runtime-env.ts). Browser code receives the values as props/arguments
 * from a server component, so the build never needs to know them.
 *
 * The PUBLIC key can be named:
 *  - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEY  (opaque `sb_publishable_…` key, new stacks)
 *  - NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY                (legacy anon JWT — what the Kong-based stack in
 *    production uses; the Kong stack does NOT accept opaque keys)
 * Privileged keys (service_role / secret) are never read here.
 */
export function inspectRuntimeSupabaseEnv(): SupabaseEnvInspection {
  return inspectSupabaseEnv({
    url: firstRuntimeEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    publishableKey: firstRuntimeEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
    ),
  });
}

export function readSupabaseEnv(): SupabasePublicEnv | null {
  return inspectRuntimeSupabaseEnv().env;
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured. Set SUPABASE_URL and a PUBLIC key (SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY, optionally with the NEXT_PUBLIC_ prefix) on the running service (see .env.example). Demo and privileged keys are refused.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}
