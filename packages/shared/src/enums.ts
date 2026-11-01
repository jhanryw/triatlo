/**
 * Closed vocabularies shared by every app. Values are technical identifiers (English);
 * user-facing labels (pt-BR) live in the UI layer.
 *
 * Nothing here encodes physiological thresholds — see docs/DECISIONS.md (Q-06).
 */

export const MODALITIES = ["swim", "bike_indoor", "run", "strength", "recovery", "rest"] as const;
export type Modality = (typeof MODALITIES)[number];

/** Planned / done / partially done / replaced / rescheduled / cancelled (spec §5). */
export const SESSION_STATUSES = [
  "planned",
  "completed",
  "partial",
  "replaced",
  "rescheduled",
  "cancelled",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Quality of the data that backed a decision. Absence is an explicit state, never zero. */
export const DATA_QUALITIES = ["complete", "partial", "missing", "conflicting"] as const;
export type DataQuality = (typeof DATA_QUALITIES)[number];

/**
 * How a proposed plan change must be handled (spec §4):
 * - auto_safe: operational/safe adjustment — may be automatic only under approved limits and enabled flag
 * - needs_approval: load/intensity increase — always needs the user's approval
 * - structural: phase change / significant progression / periodization review — always needs approval
 */
export const CHANGE_CLASSES = ["auto_safe", "needs_approval", "structural"] as const;
export type ChangeClass = (typeof CHANGE_CLASSES)[number];

export const PROPOSAL_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "applied",
  "reverted",
  "expired",
  "superseded",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const ACTOR_KINDS = ["user", "system", "engine"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const AUDIT_ACTIONS = [
  "plan_created",
  "proposal_created",
  "proposal_approved",
  "proposal_rejected",
  "proposal_expired",
  "proposal_superseded",
  "plan_version_applied",
  "plan_reverted",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const TRIGGER_TYPES = ["daily", "event", "manual"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** Row-level quality stored in the database. "missing" is NOT a row state: absence of a record is the absence of a row. */
export const ROW_QUALITIES = ["complete", "partial", "conflicting"] as const;
export type RowQuality = (typeof ROW_QUALITIES)[number];

export const COMPLETION_STATES = ["completed", "partial"] as const;
export type CompletionState = (typeof COMPLETION_STATES)[number];

export const MEAL_TYPES = ["breakfast", "lunch", "snack", "dinner", "other"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const NUTRITION_METHODS = ["manual", "ai", "reference_table"] as const;
export type NutritionMethod = (typeof NUTRITION_METHODS)[number];

export const NUTRITION_CONFIDENCES = ["low", "medium", "high"] as const;
export type NutritionConfidence = (typeof NUTRITION_CONFIDENCES)[number];

export const OBSERVATION_METRICS = ["resting_heart_rate", "heart_rate_variability"] as const;
export type ObservationMetric = (typeof OBSERVATION_METRICS)[number];

export const OBSERVATION_AVAILABILITIES = ["available", "not_measured"] as const;
export type ObservationAvailability = (typeof OBSERVATION_AVAILABILITIES)[number];

export const PLAN_STATUSES = ["active", "archived"] as const;
export const IMPORT_STATUSES = ["started", "succeeded", "failed", "partial"] as const;
export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export const DISPLAY_MODES = ["standalone", "browser"] as const;

export const AVAILABILITY_KINDS = ["training", "work", "commute", "meal", "blocked"] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];
export const RULE_SET_STATUSES = ["draft", "approved", "retired"] as const;
export const AI_CALL_STATUSES = ["ok", "error", "blocked"] as const;
export const MEAL_ANALYSIS_STATUSES = ["pending", "succeeded", "failed", "reviewed"] as const;
