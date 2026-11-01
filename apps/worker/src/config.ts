import { z } from "zod";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const WorkerConfigSchema = z.object({
  WORKER_TICK_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  // Backend-only credentials. Optional: without them the worker runs idle (no scheduling, no delivery) and says so.
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/).optional(),
});

export interface WorkerConfig {
  tickSeconds: number;
  healthPort: number;
  logLevel: LogLevel;
  supabase: { url: string; serviceRoleKey: string } | null;
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
}

/**
 * Reads worker settings from the environment. Only non-secret settings exist in Delivery 1;
 * database credentials, VAPID private key and AI keys are added in the deliveries that use them.
 */
export function parseWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const parsed = WorkerConfigSchema.parse({
    WORKER_TICK_SECONDS: env.WORKER_TICK_SECONDS || undefined,
    WORKER_HEALTH_PORT: env.WORKER_HEALTH_PORT || undefined,
    LOG_LEVEL: env.LOG_LEVEL || undefined,
    SUPABASE_URL: env.SUPABASE_URL || undefined,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY || undefined,
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY || undefined,
    VAPID_SUBJECT: env.VAPID_SUBJECT || undefined,
  });
  return {
    tickSeconds: parsed.WORKER_TICK_SECONDS,
    healthPort: parsed.WORKER_HEALTH_PORT,
    logLevel: parsed.LOG_LEVEL,
    supabase: parsed.SUPABASE_URL && parsed.SUPABASE_SERVICE_ROLE_KEY ? { url: parsed.SUPABASE_URL, serviceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY } : null,
    vapid: parsed.VAPID_PUBLIC_KEY && parsed.VAPID_PRIVATE_KEY && parsed.VAPID_SUBJECT ? { publicKey: parsed.VAPID_PUBLIC_KEY, privateKey: parsed.VAPID_PRIVATE_KEY, subject: parsed.VAPID_SUBJECT } : null,
  };
}
