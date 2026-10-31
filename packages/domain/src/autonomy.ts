import type { ChangeClass, ChangeProposal } from "@triatlo/shared";

/**
 * Autonomy configuration. Defaults are the SAFE state: nothing is applied automatically.
 *
 * `approvedLimitsVersion` is a reference to a set of quantitative limits approved by the user
 * (docs/DECISIONS.md Q-06). It stays `null` until such limits exist; this package contains no limits.
 */
export interface AutonomyConfig {
  autoApplyEnabled: boolean;
  approvedLimitsVersion: string | null;
}

export const DEFAULT_AUTONOMY: AutonomyConfig = Object.freeze({
  autoApplyEnabled: false,
  approvedLimitsVersion: null,
});

/** Outcome of the (future) guardrail evaluation for one proposal. */
export interface GuardrailVerdict {
  /** True only if an approved guardrail set evaluated the proposal and it is inside approved limits. */
  withinApprovedLimits: boolean;
}

export type ApplicationReason =
  | "proposal_not_open"
  | "requires_user_approval"
  | "auto_apply_disabled"
  | "limits_not_approved"
  | "guardrails_not_passed"
  | "auto_safe_within_limits";

export interface ApplicationDecision {
  mode: "apply" | "await_approval" | "blocked";
  reason: ApplicationReason;
}

const ALWAYS_NEEDS_APPROVAL: ReadonlySet<ChangeClass> = new Set<ChangeClass>(["needs_approval", "structural"]);

/**
 * Decides how a proposal may proceed. The decision is conservative:
 * - only `proposed` proposals can move;
 * - load/intensity increases and structural changes ALWAYS wait for the user;
 * - an `auto_safe` change is applied automatically only if auto-apply is enabled, approved limits exist
 *   AND a guardrail verdict confirmed it is inside them. Anything else waits for the user.
 */
export function decideApplication(
  proposal: Pick<ChangeProposal, "status" | "changeClass">,
  autonomy: AutonomyConfig,
  verdict?: GuardrailVerdict,
): ApplicationDecision {
  if (proposal.status !== "proposed") {
    return { mode: "blocked", reason: "proposal_not_open" };
  }
  if (ALWAYS_NEEDS_APPROVAL.has(proposal.changeClass)) {
    return { mode: "await_approval", reason: "requires_user_approval" };
  }
  if (!autonomy.autoApplyEnabled) {
    return { mode: "await_approval", reason: "auto_apply_disabled" };
  }
  if (autonomy.approvedLimitsVersion === null) {
    return { mode: "await_approval", reason: "limits_not_approved" };
  }
  if (!verdict?.withinApprovedLimits) {
    return { mode: "await_approval", reason: "guardrails_not_passed" };
  }
  return { mode: "apply", reason: "auto_safe_within_limits" };
}
