import { describe, expect, it } from "vitest";
import {
  CompletedWorkoutInputSchema,
  DailyCheckinInputSchema,
  MealItemInputSchema,
  NutritionEstimateInputSchema,
  PhysiologicalObservationInputSchema,
  PreferencesSchema,
  ProfileSchema,
  SleepObservationInputSchema,
  checkinQuality,
} from "./index";

describe("profile and preferences", () => {
  it("defaults to nothing assumed: no timezone, no consent, no autonomy", () => {
    expect(ProfileSchema.parse({})).toEqual({ displayName: null, timezone: null, locale: "pt-BR" });
    const prefs = PreferencesSchema.parse({});
    expect(prefs).toMatchObject({ notificationsEnabled: false, aiProcessingConsentAt: null, autoApplyEnabled: false, approvedLimitsVersion: null });
  });
  it("validates IANA zones and mirrors the database rules", () => {
    expect(ProfileSchema.parse({ timezone: "America/Sao_Paulo" }).timezone).toBe("America/Sao_Paulo");
    expect(() => ProfileSchema.parse({ timezone: "Mars/Olympus" })).toThrow();
    expect(() => PreferencesSchema.parse({ quietHoursStart: "22:00" })).toThrow();
    expect(() => PreferencesSchema.parse({ autoApplyEnabled: true })).toThrow();
    expect(PreferencesSchema.parse({ autoApplyEnabled: true, approvedLimitsVersion: "v1" }).autoApplyEnabled).toBe(true);
  });
});

describe("daily check-in", () => {
  it("rejects an empty check-in and out-of-scale scores", () => {
    expect(() => DailyCheckinInputSchema.parse({ checkinDate: "2026-11-02" })).toThrow();
    expect(() => DailyCheckinInputSchema.parse({ checkinDate: "2026-11-02", moodScore: 0 })).toThrow();
    expect(() => DailyCheckinInputSchema.parse({ checkinDate: "2026-11-02", moodScore: 6 })).toThrow();
    expect(() => DailyCheckinInputSchema.parse({ checkinDate: "02/11/2026", moodScore: 3 })).toThrow();
  });
  it("keeps unanswered scores null and derives quality like the database does", () => {
    const partial = DailyCheckinInputSchema.parse({ checkinDate: "2026-11-02", fatigueScore: 4 });
    expect(partial.moodScore).toBeNull();
    expect(checkinQuality(partial)).toBe("partial");
    const full = DailyCheckinInputSchema.parse({ checkinDate: "2026-11-02", sleepQualityScore: 3, fatigueScore: 3, energyScore: 3, moodScore: 3, recoveryScore: 3 });
    expect(checkinQuality(full)).toBe("complete");
  });
});

describe("sleep and physiological observations", () => {
  it("distinguishes unknown duration (null) from a recorded zero", () => {
    expect(SleepObservationInputSchema.parse({ nightDate: "2026-11-02", durationMinutes: 0 }).durationMinutes).toBe(0);
    expect(SleepObservationInputSchema.parse({ nightDate: "2026-11-02", subjectiveQuality: 2 }).durationMinutes).toBeNull();
    expect(() => SleepObservationInputSchema.parse({ nightDate: "2026-11-02" })).toThrow();
    expect(() => SleepObservationInputSchema.parse({ nightDate: "2026-11-02", durationMinutes: -1 })).toThrow();
    expect(() => SleepObservationInputSchema.parse({ nightDate: "2026-11-02", startedAt: "2026-11-02T08:00:00Z", endedAt: "2026-11-02T07:00:00Z" })).toThrow();
  });
  it("requires an external id for non-manual sources (idempotent imports)", () => {
    expect(() => SleepObservationInputSchema.parse({ nightDate: "2026-11-02", durationMinutes: 400, source: "file_import" })).toThrow();
    expect(SleepObservationInputSchema.parse({ nightDate: "2026-11-02", durationMinutes: 400, source: "file_import", externalId: "x" }).source).toBe("file_import");
  });
  it("separates available, not measured and zero", () => {
    const zero = PhysiologicalObservationInputSchema.parse({ metric: "resting_heart_rate", observedAt: "2026-11-02T07:00:00Z", value: 0, unit: "bpm" });
    expect(zero.value).toBe(0);
    const none = PhysiologicalObservationInputSchema.parse({ metric: "heart_rate_variability", observedAt: "2026-11-02T07:00:00Z", availability: "not_measured" });
    expect(none.value).toBeNull();
    expect(() => PhysiologicalObservationInputSchema.parse({ metric: "heart_rate_variability", observedAt: "2026-11-02T07:00:00Z", availability: "not_measured", value: 40, unit: "ms" })).toThrow();
    expect(() => PhysiologicalObservationInputSchema.parse({ metric: "resting_heart_rate", observedAt: "2026-11-02T07:00:00Z" })).toThrow();
    expect(() => PhysiologicalObservationInputSchema.parse({ metric: "blood_glucose", observedAt: "2026-11-02T07:00:00Z", value: 90, unit: "x" })).toThrow();
  });
});

describe("completed workouts, meals and estimates", () => {
  it("keeps unknown measures null and rejects a zero duration", () => {
    const w = CompletedWorkoutInputSchema.parse({ modality: "run", startedAt: "2026-11-02T18:00:00Z" });
    expect(w).toMatchObject({ durationMinutes: null, distanceMeters: null, avgHeartRateBpm: null, completion: "completed", source: "manual" });
    expect(() => CompletedWorkoutInputSchema.parse({ modality: "run", startedAt: "2026-11-02T18:00:00Z", durationMinutes: 0 })).toThrow();
    expect(() => CompletedWorkoutInputSchema.parse({ modality: "run", startedAt: "2026-11-02T18:00:00Z", perceivedExertionScale: "rpe" })).toThrow();
  });
  it("treats item quantity 0 as deliberate and null as unknown", () => {
    expect(MealItemInputSchema.parse({ name: "molho", quantity: 0, unit: "g" }).quantity).toBe(0);
    expect(MealItemInputSchema.parse({ name: "arroz" }).quantity).toBeNull();
    expect(() => MealItemInputSchema.parse({ name: "x", quantity: 5 })).toThrow();
  });
  it("requires at least one estimated value; 0 counts as a value", () => {
    expect(() => NutritionEstimateInputSchema.parse({ method: "ai" })).toThrow();
    expect(NutritionEstimateInputSchema.parse({ method: "manual", energyKcal: 0 }).energyKcal).toBe(0);
    expect(() => NutritionEstimateInputSchema.parse({ method: "guess", energyKcal: 10 })).toThrow();
  });
});

import { DEFAULT_RULE_SET_PARAMS, MealAnalysisResultSchema, RuleSetParamsSchema } from "./index";

describe("engine contracts", () => {
  it("the project's draft rule set is valid, relative, reduction-only and conservative", () => {
    const p = RuleSetParamsSchema.parse(DEFAULT_RULE_SET_PARAMS);
    expect(p.reduction.durationFraction).toBeLessThanOrEqual(0.5);
    expect(p.reduction.maxAutoFraction).toBeLessThanOrEqual(p.reduction.durationFraction);
    expect(Object.keys(p).sort()).toEqual(["horizonHours", "lookbackDays", "minKnownDays", "reduction", "schemaVersion", "sleep", "stability", "subjective"]);
  });
  it("rejects parameters that would allow large cuts or unknown knobs", () => {
    const bad = { ...DEFAULT_RULE_SET_PARAMS, reduction: { durationFraction: 0.9, maxAutoFraction: 0.9 } };
    expect(() => RuleSetParamsSchema.parse(bad)).toThrow();
    expect(() => RuleSetParamsSchema.parse({ ...DEFAULT_RULE_SET_PARAMS, increaseFraction: 0.1 })).toThrow();
  });
  it("validates untrusted AI meal output and keeps unknown values null", () => {
    const ok = MealAnalysisResultSchema.parse({
      isFood: true, overallConfidence: "low", uncertaintyNotes: "óleo de cozimento não visível",
      items: [{ name: "arroz", quantity: 150, unit: "g", confidence: "medium", energyKcal: 190, proteinG: null, carbohydrateG: 42, fatG: null }],
    });
    expect(ok.items[0]?.proteinG).toBeNull();
    expect(() => MealAnalysisResultSchema.parse({ isFood: true, overallConfidence: "certain", uncertaintyNotes: null, items: [] })).toThrow();
    expect(() => MealAnalysisResultSchema.parse({ isFood: true, overallConfidence: "low", uncertaintyNotes: null, items: [], diagnosis: "x" })).toThrow();
  });
});
