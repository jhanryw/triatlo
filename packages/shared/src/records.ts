import { z } from "zod";
import {
  COMPLETION_STATES,
  MEAL_TYPES,
  MODALITIES,
  NUTRITION_CONFIDENCES,
  NUTRITION_METHODS,
  OBSERVATION_AVAILABILITIES,
  OBSERVATION_METRICS,
  ROW_QUALITIES,
} from "./enums";
import { UtcDateTimeSchema } from "./common";
import { SOURCE_KINDS } from "./data-source";

/**
 * Input contracts for the personal records stored in the database (supabase/migrations). They mirror the SQL constraints:
 * the same rules are enforced twice on purpose (fast feedback in the app, hard guarantee in the database), and
 * supabase/migrations is checked against these vocabularies by db-contract.test.ts.
 *
 * Rule shared by all of them: UNKNOWN is `null`/omitted — never 0. A real zero is a real 0. No record = no row.
 */

/** Local calendar date, decided by the app from the user's timezone. */
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

/** Self-report score. The 1..5 scale is PROPOSAL P-29 (pending approval); it carries no clinical meaning. */
export const ScoreSchema = z.number().int().min(1).max(5);

const provenance = {
  source: z.enum(SOURCE_KINDS).default("manual"),
  externalId: z.string().min(1).nullable().default(null),
  quality: z.enum(ROW_QUALITIES).default("complete"),
};

const externalIdRule = (value: { source: string; externalId: string | null }) =>
  value.source === "manual" || value.externalId !== null;
const externalIdIssue = { message: "externalId is required when the source is not manual", path: ["externalId"] };

export const ProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).nullable().default(null),
    /** IANA zone. null = not set yet (nothing assumes a zone). */
    timezone: z
      .string()
      .min(3)
      .max(64)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, "unknown IANA timezone")
      .nullable()
      .default(null),
    locale: z.string().min(2).default("pt-BR"),
  })
  .strict();
export type Profile = z.infer<typeof ProfileSchema>;

export const PreferencesSchema = z
  .object({
    weekStartsOn: z.number().int().min(0).max(6).default(1),
    quietHoursStart: LocalTimeSchema.nullable().default(null),
    quietHoursEnd: LocalTimeSchema.nullable().default(null),
    notificationsEnabled: z.boolean().default(false),
    /** null = no consent: nothing is sent to an AI provider. */
    aiProcessingConsentAt: UtcDateTimeSchema.nullable().default(null),
    autoApplyEnabled: z.boolean().default(false),
    approvedLimitsVersion: z.string().min(1).nullable().default(null),
  })
  .strict()
  .refine((p) => (p.quietHoursStart === null) === (p.quietHoursEnd === null), {
    message: "quiet hours need both start and end (or neither)",
    path: ["quietHoursEnd"],
  })
  .refine((p) => !p.autoApplyEnabled || p.approvedLimitsVersion !== null, {
    message: "automatic application requires an approved set of limits",
    path: ["autoApplyEnabled"],
  });
export type Preferences = z.infer<typeof PreferencesSchema>;

export const DailyCheckinInputSchema = z
  .object({
    checkinDate: LocalDateSchema,
    sleepQualityScore: ScoreSchema.nullable().default(null),
    fatigueScore: ScoreSchema.nullable().default(null),
    energyScore: ScoreSchema.nullable().default(null),
    moodScore: ScoreSchema.nullable().default(null),
    recoveryScore: ScoreSchema.nullable().default(null),
    notes: z.string().trim().min(1).nullable().default(null),
  })
  .strict()
  .refine(
    (c) =>
      [c.sleepQualityScore, c.fatigueScore, c.energyScore, c.moodScore, c.recoveryScore].some((v) => v !== null) ||
      c.notes !== null,
    "a check-in with no answer is the same as no check-in",
  );
export type DailyCheckinInput = z.infer<typeof DailyCheckinInputSchema>;

/** Same rule as the generated `quality` column of daily_checkins. */
export function checkinQuality(c: Pick<DailyCheckinInput, "sleepQualityScore" | "fatigueScore" | "energyScore" | "moodScore" | "recoveryScore">): "complete" | "partial" {
  return [c.sleepQualityScore, c.fatigueScore, c.energyScore, c.moodScore, c.recoveryScore].every((v) => v !== null)
    ? "complete"
    : "partial";
}

export const SleepObservationInputSchema = z
  .object({
    nightDate: LocalDateSchema,
    startedAt: UtcDateTimeSchema.nullable().default(null),
    endedAt: UtcDateTimeSchema.nullable().default(null),
    /** null = unknown. 0 is a real recorded zero. */
    durationMinutes: z.number().int().min(0).nullable().default(null),
    subjectiveQuality: ScoreSchema.nullable().default(null),
    stages: z.record(z.string(), z.unknown()).nullable().default(null),
    ...provenance,
  })
  .strict()
  .refine((s) => s.startedAt === null || s.endedAt === null || Date.parse(s.endedAt) > Date.parse(s.startedAt), {
    message: "sleep must end after it starts",
    path: ["endedAt"],
  })
  .refine(
    (s) => s.durationMinutes !== null || (s.startedAt !== null && s.endedAt !== null) || s.subjectiveQuality !== null,
    "a sleep record with no information is the same as no record",
  )
  .refine(externalIdRule, externalIdIssue);
export type SleepObservationInput = z.infer<typeof SleepObservationInputSchema>;

export const PhysiologicalObservationInputSchema = z
  .object({
    metric: z.enum(OBSERVATION_METRICS),
    observedAt: UtcDateTimeSchema,
    availability: z.enum(OBSERVATION_AVAILABILITIES).default("available"),
    value: z.number().min(0).nullable().default(null),
    unit: z.string().min(1).nullable().default(null),
    method: z.string().min(1).nullable().default(null),
    ...provenance,
  })
  .strict()
  .refine(
    (o) =>
      o.availability === "available"
        ? o.value !== null && o.unit !== null
        : o.value === null && o.unit === null,
    "available needs value and unit; not_measured must carry neither",
  )
  .refine(externalIdRule, externalIdIssue);
export type PhysiologicalObservationInput = z.infer<typeof PhysiologicalObservationInputSchema>;

export const CompletedWorkoutInputSchema = z
  .object({
    plannedSessionId: z.uuid().nullable().default(null),
    modality: z.enum(MODALITIES),
    completion: z.enum(COMPLETION_STATES).default("completed"),
    startedAt: UtcDateTimeSchema,
    /** null = unknown (0 is rejected). */
    durationMinutes: z.number().int().positive().nullable().default(null),
    distanceMeters: z.number().min(0).nullable().default(null),
    avgHeartRateBpm: z.number().int().positive().nullable().default(null),
    maxHeartRateBpm: z.number().int().positive().nullable().default(null),
    perceivedExertionScale: z.string().min(1).nullable().default(null),
    perceivedExertionValue: z.number().nullable().default(null),
    notes: z.string().trim().min(1).nullable().default(null),
    ...provenance,
  })
  .strict()
  .refine((w) => (w.perceivedExertionScale === null) === (w.perceivedExertionValue === null), {
    message: "perceived exertion needs both scale and value",
    path: ["perceivedExertionValue"],
  })
  .refine(externalIdRule, externalIdIssue);
export type CompletedWorkoutInput = z.infer<typeof CompletedWorkoutInputSchema>;

export const MealInputSchema = z
  .object({
    eatenAt: UtcDateTimeSchema,
    mealType: z.enum(MEAL_TYPES),
    notes: z.string().trim().min(1).nullable().default(null),
    /** Path in the private bucket: "<user id>/...". */
    photoPath: z.string().min(1).nullable().default(null),
  })
  .strict();
export type MealInput = z.infer<typeof MealInputSchema>;

export const MealItemInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** null = unknown quantity; 0 is a deliberate zero. */
    quantity: z.number().min(0).nullable().default(null),
    unit: z.string().min(1).nullable().default(null),
    quantityOrigin: z.enum(["user", "estimated"]).default("user"),
    userCorrected: z.boolean().default(false),
  })
  .strict()
  .refine((i) => (i.quantity === null) === (i.unit === null), {
    message: "quantity and unit go together",
    path: ["unit"],
  });
export type MealItemInput = z.infer<typeof MealItemInputSchema>;

export const NutritionEstimateInputSchema = z
  .object({
    /** null = not estimated; 0 = estimated as zero. */
    energyKcal: z.number().min(0).nullable().default(null),
    proteinG: z.number().min(0).nullable().default(null),
    carbohydrateG: z.number().min(0).nullable().default(null),
    fatG: z.number().min(0).nullable().default(null),
    method: z.enum(NUTRITION_METHODS),
    model: z.string().min(1).nullable().default(null),
    confidence: z.enum(NUTRITION_CONFIDENCES).nullable().default(null),
    notes: z.string().trim().min(1).nullable().default(null),
  })
  .strict()
  .refine((e) => [e.energyKcal, e.proteinG, e.carbohydrateG, e.fatG].some((v) => v !== null), "an estimate needs at least one value");
export type NutritionEstimateInput = z.infer<typeof NutritionEstimateInputSchema>;
