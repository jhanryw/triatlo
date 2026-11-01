import { z } from "zod";
import { AVAILABILITY_KINDS, NUTRITION_CONFIDENCES } from "./enums";

/**
 * Policy parameters of the adaptation engine. They are DATA, not code: versioned in `training_rule_sets`, immutable once
 * created, and they only take effect after the USER approves that version (docs/BUSINESS_RULES.md).
 *
 * Design rules:
 *  - every trigger is RELATIVE to the person's own baseline (median of their own recent days) — there are no absolute
 *    clinical thresholds anywhere;
 *  - the engine can only propose REDUCTIONS of planned sessions. Increases/progressions are never produced by rules;
 *  - unknown/missing data never triggers anything and breaks a streak (absence is not "fine" and not "bad").
 */
export const RuleSetParamsSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Days of the person's own history used for baselines. */
    lookbackDays: z.number().int().min(7).max(60),
    /** Minimum days with real data in the lookback window before the engine may propose anything. */
    minKnownDays: z.number().int().min(3).max(30),
    subjective: z
      .object({
        /** A score counts as "worse" when it is at least this many points worse than the personal baseline median. */
        minPointsWorse: z.number().min(0.5).max(4),
        /** Consecutive days (each with real data) the worsening must persist. */
        consecutiveDays: z.number().int().min(2).max(7),
      })
      .strict(),
    sleep: z
      .object({
        /** Sleep counts as short when below baseline by this fraction. */
        shortfallFraction: z.number().min(0.05).max(0.5),
      })
      .strict(),
    reduction: z
      .object({
        /** Fraction of a session's planned duration removed by a proposal (never more than 0.5). */
        durationFraction: z.number().min(0.05).max(0.5),
        /** Reductions up to this fraction may be applied automatically (only if the user enabled auto-apply for this version). */
        maxAutoFraction: z.number().min(0).max(0.5),
      })
      .strict(),
    stability: z
      .object({
        minHoursBetweenChangesPerSession: z.number().min(1).max(168),
        maxProposalsPerWeek: z.number().int().min(1).max(14),
      })
      .strict(),
    /** Only sessions starting within this many hours from now are considered. */
    horizonHours: z.number().int().min(6).max(168),
  })
  .strict()
  .refine((p) => p.reduction.maxAutoFraction <= p.reduction.durationFraction || p.reduction.maxAutoFraction <= 0.5, "invalid reduction limits");
export type RuleSetParams = z.infer<typeof RuleSetParamsSchema>;

/**
 * Initial DRAFT proposed by the project (v0). These numbers are policy choices, NOT medical or physiological facts, and
 * they are inactive until the user approves them in Settings. They are deliberately conservative: relative triggers,
 * reductions only, small fraction, short horizon, rate-limited.
 */
export const DEFAULT_RULE_SET_PARAMS: RuleSetParams = {
  schemaVersion: 1,
  lookbackDays: 14,
  minKnownDays: 5,
  subjective: { minPointsWorse: 1, consecutiveDays: 2 },
  sleep: { shortfallFraction: 0.2 },
  reduction: { durationFraction: 0.2, maxAutoFraction: 0.2 },
  stability: { minHoursBetweenChangesPerSession: 24, maxProposalsPerWeek: 3 },
  horizonHours: 48,
};

export const AvailabilityWindowInputSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    kind: z.enum(AVAILABILITY_KINDS),
    label: z.string().trim().min(1).nullable().default(null),
  })
  .strict()
  .refine((w) => w.endsAt > w.startsAt, { message: "window must end after it starts", path: ["endsAt"] });
export type AvailabilityWindowInput = z.infer<typeof AvailabilityWindowInputSchema>;

/**
 * Output of the meal-photo analysis, as returned by an AI provider. UNTRUSTED input: validated before use.
 * Every number is an ESTIMATE; `null` means "not estimated" (never 0). The user reviews and corrects it.
 */
export const MealAnalysisResultSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            quantity: z.number().min(0).nullable(),
            unit: z.string().min(1).nullable(),
            confidence: z.enum(NUTRITION_CONFIDENCES),
            energyKcal: z.number().min(0).nullable(),
            proteinG: z.number().min(0).nullable(),
            carbohydrateG: z.number().min(0).nullable(),
            fatG: z.number().min(0).nullable(),
          })
          .strict(),
      )
      .max(30),
    overallConfidence: z.enum(NUTRITION_CONFIDENCES),
    /** Anything the model could not see/judge (hidden ingredients, portion size, oils...). */
    uncertaintyNotes: z.string().trim().min(1).nullable(),
    /** The model must say when the image does not show food. */
    isFood: z.boolean(),
  })
  .strict();
export type MealAnalysisResult = z.infer<typeof MealAnalysisResultSchema>;
