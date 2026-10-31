import { z } from "zod";
import { IdSchema, UtcDateTimeSchema } from "./common";

/** Job types known so far. Handlers are added in the deliveries that need them. */
export const JOB_TYPES = ["notification.dispatch", "adapt.daily", "adapt.evaluate"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  "pending",
  "claimed",
  "succeeded",
  "failed",
  "dead",
  "cancelled",
  "superseded",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JobEnvelopeSchema = z
  .object({
    id: IdSchema,
    type: z.enum(JOB_TYPES),
    userId: IdSchema,
    runAt: UtcDateTimeSchema,
    status: z.enum(JOB_STATUSES),
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    /** Unique per logical job; inserting a duplicate is a no-op. */
    idempotencyKey: z.string().min(1),
    /** Entity version that originated the job (e.g. "session:<id>@v3"); used for supersession on reschedule. */
    sourceRef: z.string().min(1).nullable().default(null),
    payload: z.record(z.string(), z.unknown()).default({}),
    lastError: z.string().nullable().default(null),
  })
  .strict();
export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;

export interface IdempotencyKeyParts {
  type: JobType;
  userId: string;
  /** Entity the job refers to (session id, meal id, date bucket...). */
  entity: string;
  /** Entity version or window bucket (e.g. "v3" or "2026-11-02"). */
  discriminator: string;
}

/** Deterministic key: same logical job => same key. Parts must not contain ":". */
export function buildIdempotencyKey(parts: IdempotencyKeyParts): string {
  for (const [name, value] of Object.entries(parts)) {
    if (value.length === 0 || value.includes(":")) {
      throw new Error(`invalid idempotency key part "${name}": must be non-empty and must not contain ":"`);
    }
  }
  return `${parts.type}:${parts.userId}:${parts.entity}:${parts.discriminator}`;
}
