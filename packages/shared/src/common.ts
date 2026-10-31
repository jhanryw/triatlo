import { z } from "zod";
import { ACTOR_KINDS } from "./enums";

/** UTC instant, ISO-8601 (e.g. 2026-11-02T09:30:00Z). The user's IANA zone lives in the profile. */
export const UtcDateTimeSchema = z.iso.datetime();

export const IdSchema = z.uuid();

export const ActorSchema = z
  .object({
    kind: z.enum(ACTOR_KINDS),
    /** Optional reference, e.g. a user id or a rule/engine identifier. */
    ref: z.string().min(1).nullable().default(null),
  })
  .strict();
export type Actor = z.infer<typeof ActorSchema>;

/** Reference to a piece of data used to justify a decision. */
export const DataRefSchema = z
  .object({
    kind: z.string().min(1),
    id: z.string().min(1),
    observedAt: UtcDateTimeSchema.nullable().default(null),
  })
  .strict();
export type DataRef = z.infer<typeof DataRefSchema>;
