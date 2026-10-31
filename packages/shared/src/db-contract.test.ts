import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTOR_KINDS,
  APPROVAL_DECISIONS,
  AUDIT_ACTIONS,
  CHANGE_CLASSES,
  COMPLETION_STATES,
  DISPLAY_MODES,
  IMPORT_STATUSES,
  JOB_STATUSES,
  JOB_TYPES,
  MEAL_TYPES,
  MODALITIES,
  NOTIFICATION_KINDS,
  NUTRITION_CONFIDENCES,
  NUTRITION_METHODS,
  OBSERVATION_AVAILABILITIES,
  OBSERVATION_METRICS,
  PLAN_STATUSES,
  PROPOSAL_STATUSES,
  ROW_QUALITIES,
  SESSION_STATUSES,
  SOURCE_KINDS,
  TRIGGER_TYPES,
  CompletedWorkoutInputSchema,
  DailyCheckinInputSchema,
  MealInputSchema,
  MealItemInputSchema,
  NutritionEstimateInputSchema,
  PhysiologicalObservationInputSchema,
  PreferencesSchema,
  ProfileSchema,
  SleepObservationInputSchema,
} from "./index";

/**
 * Keeps supabase/migrations and the TypeScript contracts from drifting apart: every CHECK (col IN (...)) vocabulary in the
 * SQL must equal the corresponding constant in this package, and every field of a record schema must be a real column.
 */
const dir = new URL("../../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");

function checkList(constraint: string): string[] {
  const match = new RegExp(`constraint ${constraint}\\s+check\\s*\\(\\s*(?:\\w+\\s+is\\s+null\\s+or\\s+)?\\w+\\s+in\\s*\\(([^)]*)\\)`, "i").exec(sql);
  if (!match?.[1]) throw new Error(`constraint ${constraint} not found in migrations`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

const sorted = (list: readonly string[]) => [...list].sort();

describe("SQL CHECK vocabularies match packages/shared", () => {
  const cases: Array<[string, readonly string[]]> = [
    ["planned_workouts_modality_check", MODALITIES],
    ["completed_workouts_modality_check", MODALITIES],
    ["planned_workouts_status_check", SESSION_STATUSES],
    ["workout_change_proposals_class_check", CHANGE_CLASSES],
    ["workout_change_proposals_trigger_check", TRIGGER_TYPES],
    ["workout_change_proposals_status_check", PROPOSAL_STATUSES],
    ["training_plan_versions_created_by_kind_check", ACTOR_KINDS],
    ["adaptation_audit_actor_kind_check", ACTOR_KINDS],
    ["adaptation_audit_action_check", AUDIT_ACTIONS],
    ["user_approvals_decision_check", APPROVAL_DECISIONS],
    ["training_plans_status_check", PLAN_STATUSES],
    ["data_import_provenance_status_check", IMPORT_STATUSES],
    ["data_import_provenance_source_kind_check", SOURCE_KINDS],
    ["completed_workouts_source_check", SOURCE_KINDS],
    ["completed_workouts_completion_check", COMPLETION_STATES],
    ["completed_workouts_quality_check", ROW_QUALITIES],
    ["daily_checkins_source_check", SOURCE_KINDS],
    ["sleep_observations_source_check", SOURCE_KINDS],
    ["sleep_observations_quality_check", ROW_QUALITIES],
    ["physiological_observations_metric_check", OBSERVATION_METRICS],
    ["physiological_observations_availability_check", OBSERVATION_AVAILABILITIES],
    ["physiological_observations_source_check", SOURCE_KINDS],
    ["physiological_observations_quality_check", ROW_QUALITIES],
    ["meals_meal_type_check", MEAL_TYPES],
    ["meals_source_check", SOURCE_KINDS],
    ["nutrition_estimates_method_check", NUTRITION_METHODS],
    ["nutrition_estimates_confidence_check", NUTRITION_CONFIDENCES],
    ["push_subscriptions_display_mode_check", DISPLAY_MODES],
    ["scheduled_notifications_kind_check", NOTIFICATION_KINDS],
    ["scheduled_notifications_status_check", ["pending", "claimed", "sent", "failed", "cancelled", "superseded"]],
    ["background_jobs_type_check", JOB_TYPES],
    ["background_jobs_status_check", JOB_STATUSES],
  ];
  it.each(cases)("%s", (constraint, expected) => {
    expect(sorted(checkList(constraint))).toEqual(sorted(expected));
  });

  it("'missing' is a data-quality state of a decision, never a stored row state", () => {
    expect(ROW_QUALITIES).not.toContain("missing");
  });
});

function columnsOf(table: string): Set<string> {
  const block = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, "i").exec(sql)?.[1];
  if (!block) throw new Error(`table ${table} not found in migrations`);
  const cols = new Set<string>();
  for (const line of block.split("\n")) {
    const m = /^ {2}([a-z_][a-z0-9_]*)\s+(?!check\b|constraint\b|unique\b|foreign\b|primary\b)\S/.exec(line);
    if (m?.[1]) cols.add(m[1]);
  }
  return cols;
}
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe("record schemas only use real columns", () => {
  const shapes: Array<[string, { shape: Record<string, unknown> }]> = [];
  const shapeOf = (schema: unknown): Record<string, unknown> => {
    // refinements wrap the object schema; zod 4 keeps the original under _zod.def.
    let current = schema as { _zod?: { def?: { shape?: Record<string, unknown>; innerType?: unknown } }; def?: unknown };
    for (let i = 0; i < 6 && current; i++) {
      const def = current._zod?.def;
      if (def?.shape) return def.shape;
      current = (def?.innerType ?? undefined) as typeof current;
    }
    throw new Error("could not unwrap schema shape");
  };
  const map: Array<[string, unknown]> = [
    ["profiles", ProfileSchema],
    ["user_preferences", PreferencesSchema],
    ["daily_checkins", DailyCheckinInputSchema],
    ["sleep_observations", SleepObservationInputSchema],
    ["physiological_observations", PhysiologicalObservationInputSchema],
    ["completed_workouts", CompletedWorkoutInputSchema],
    ["meals", MealInputSchema],
    ["meal_items", MealItemInputSchema],
    ["nutrition_estimates", NutritionEstimateInputSchema],
  ];
  void shapes;
  it.each(map)("%s", (table, schema) => {
    const columns = columnsOf(table);
    const exceptions: Record<string, string> = { plannedSessionId: "planned_session_id", photoPath: "photo_path" };
    for (const key of Object.keys(shapeOf(schema))) {
      const column = exceptions[key] ?? snake(key);
      expect(columns.has(column), `${table}.${column} (from "${key}") is not a column`).toBe(true);
    }
  });
});
