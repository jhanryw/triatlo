import { z } from "zod";
import { ActorSchema, IdSchema, UtcDateTimeSchema } from "./common";
import { MODALITIES, SESSION_STATUSES } from "./enums";

/**
 * Intensity is intentionally opaque: the scale (zones, RPE, pace...) is defined later in
 * docs/BUSINESS_RULES.md. No default scale or numeric limits are assumed here.
 */
export const IntensitySchema = z
  .object({
    scale: z.string().min(1),
    value: z.union([z.string().min(1), z.number()]),
  })
  .strict();
export type Intensity = z.infer<typeof IntensitySchema>;

/** A target metric appropriate to the session (e.g. duration, distance). Free-form on purpose. */
export const TargetMetricSchema = z
  .object({
    metric: z.string().min(1),
    unit: z.string().min(1),
    value: z.number(),
  })
  .strict();
export type TargetMetric = z.infer<typeof TargetMetricSchema>;

export const PlannedSessionSchema = z
  .object({
    id: IdSchema,
    modality: z.enum(MODALITIES),
    objective: z.string().min(1).nullable().default(null),
    startsAt: UtcDateTimeSchema,
    durationMinutes: z.number().int().positive(),
    intensity: IntensitySchema.nullable().default(null),
    targets: z.array(TargetMetricSchema).default([]),
    instructions: z.string().min(1).nullable().default(null),
    status: z.enum(SESSION_STATUSES).default("planned"),
  })
  .strict();
export type PlannedSession = z.infer<typeof PlannedSessionSchema>;

/** Fields of a session that a change may update (identity, status and timing have their own changes). */
// Declared without `.default()` on purpose: a partial update must not inject defaults over existing values.
export const SessionUpdatableFieldsSchema = z
  .object({
    objective: z.string().min(1).nullable().optional(),
    durationMinutes: z.number().int().positive().optional(),
    intensity: IntensitySchema.nullable().optional(),
    targets: z.array(TargetMetricSchema).optional(),
    instructions: z.string().min(1).nullable().optional(),
  })
  .strict()
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
    message: "at least one field is required",
  });
export type SessionUpdatableFields = z.infer<typeof SessionUpdatableFieldsSchema>;

/**
 * Immutable snapshot of a training plan. Every accepted change produces a NEW version;
 * versions are never edited. Reverting also creates a new version (revertOf set).
 */
export const PlanVersionSchema = z
  .object({
    id: IdSchema,
    planId: IdSchema,
    /** Monotonic, starting at 1. */
    version: z.number().int().positive(),
    parentVersion: z.number().int().positive().nullable(),
    createdAt: UtcDateTimeSchema,
    createdBy: ActorSchema,
    reason: z.string().min(1),
    sessions: z.array(PlannedSessionSchema),
    /** Proposal that originated this version, if any. */
    proposalId: IdSchema.nullable().default(null),
    /** Version whose content was restored by this version, if it is a revert. */
    revertOf: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type PlanVersion = z.infer<typeof PlanVersionSchema>;
