import { z } from "zod";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const WorkerConfigSchema = z.object({
  WORKER_TICK_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

export interface WorkerConfig {
  tickSeconds: number;
  healthPort: number;
  logLevel: LogLevel;
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
  });
  return {
    tickSeconds: parsed.WORKER_TICK_SECONDS,
    healthPort: parsed.WORKER_HEALTH_PORT,
    logLevel: parsed.LOG_LEVEL,
  };
}
