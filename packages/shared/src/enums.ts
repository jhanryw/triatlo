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
