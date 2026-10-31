import type {
  Actor,
  ApprovalDecision,
  AuditEntry,
  ChangeProposal,
  PlanChange,
  PlanVersion,
  PlannedSession,
} from "@triatlo/shared";
import type { ApplicationDecision } from "./autonomy";
import type { DomainContext } from "./context";
import { PlanDomainError } from "./errors";

/** What authorizes applying a proposal: an explicit user approval, or an automatic-policy decision. */
export type ApplicationBasis =
  | { type: "user_approval"; approval: ApprovalDecision }
  | { type: "auto_policy"; decision: ApplicationDecision };

export interface ApplyProposalInput {
  current: PlanVersion;
  proposal: ChangeProposal;
  basis: ApplicationBasis;
  actor: Actor;
}

export interface ApplyProposalResult {
  nextVersion: PlanVersion;
  proposal: ChangeProposal;
  audit: AuditEntry[];
}

function applyChange(sessions: PlannedSession[], change: PlanChange): PlannedSession[] {
  const indexOf = (sessionId: string) => sessions.findIndex((session) => session.id === sessionId);

  switch (change.type) {
    case "add_session": {
      if (indexOf(change.session.id) !== -1) {
        throw new PlanDomainError("duplicate_session", `session ${change.session.id} already exists`);
      }
      return [...sessions, change.session];
    }
    case "reschedule_session":
    case "update_session":
    case "cancel_session": {
      const index = indexOf(change.sessionId);
      const existing = sessions[index];
      if (index === -1 || existing === undefined) {
        throw new PlanDomainError("unknown_session", `session ${change.sessionId} not found in plan`);
      }
      let updated: PlannedSession;
      if (change.type === "reschedule_session") {
        // Versions keep the history of the move; the status is not changed by this module.
        updated = { ...existing, startsAt: change.newStartsAt };
      } else if (change.type === "cancel_session") {
        updated = { ...existing, status: "cancelled" };
      } else {
        const defined = Object.fromEntries(Object.entries(change.fields).filter(([, value]) => value !== undefined));
        updated = { ...existing, ...defined };
      }
      return sessions.map((session, i) => (i === index ? updated : session));
    }
  }
}

function assertAuthorized(proposal: ChangeProposal, basis: ApplicationBasis): void {
  if (basis.type === "user_approval") {
    const { approval } = basis;
    if (approval.proposalId !== proposal.id || approval.decision !== "approved") {
      throw new PlanDomainError("authorization_missing", "no matching user approval for this proposal");
    }
    if (proposal.status !== "approved") {
      throw new PlanDomainError("proposal_not_applicable", `proposal status is "${proposal.status}", expected "approved"`);
    }
    return;
  }
  if (basis.decision.mode !== "apply" || proposal.changeClass !== "auto_safe") {
    throw new PlanDomainError("authorization_missing", "automatic application is not authorized for this proposal");
  }
  if (proposal.status !== "proposed") {
    throw new PlanDomainError("proposal_not_applicable", `proposal status is "${proposal.status}", expected "proposed"`);
  }
}

/**
 * Applies a proposal producing a NEW immutable plan version, the updated proposal and audit entries.
 * Pure: it never mutates its inputs. Validation failures throw PlanDomainError.
 */
export function applyProposal(input: ApplyProposalInput, ctx: DomainContext): ApplyProposalResult {
  const { current, proposal, basis, actor } = input;

  if (proposal.planId !== current.planId) {
    throw new PlanDomainError("plan_mismatch", "proposal belongs to a different plan");
  }
  if (proposal.baseVersion !== current.version) {
    throw new PlanDomainError(
      "stale_base_version",
      `proposal was computed on v${proposal.baseVersion} but the plan is at v${current.version}`,
    );
  }
  assertAuthorized(proposal, basis);

  const sessions = proposal.changes.reduce(applyChange, current.sessions);
  const now = ctx.now();

  const nextVersion: PlanVersion = {
    id: ctx.newId(),
    planId: current.planId,
    version: current.version + 1,
    parentVersion: current.version,
    createdAt: now,
    createdBy: actor,
    reason: proposal.rationale.summary,
    sessions,
    proposalId: proposal.id,
    revertOf: null,
  };

  const appliedProposal: ChangeProposal = {
    ...proposal,
    status: "applied",
    decidedAt: proposal.decidedAt ?? now,
    appliedVersion: nextVersion.version,
  };

  const audit: AuditEntry = {
    id: ctx.newId(),
    occurredAt: now,
    actor,
    action: "plan_version_applied",
    planId: current.planId,
    proposalId: proposal.id,
    fromVersion: current.version,
    toVersion: nextVersion.version,
    ruleIds: proposal.rationale.ruleIds,
    summary: proposal.rationale.summary,
    details: {
      basis: basis.type,
      changeClass: proposal.changeClass,
      changeTypes: proposal.changes.map((change) => change.type),
      dataQuality: proposal.rationale.dataQuality,
      dataRefs: proposal.rationale.dataRefs,
    },
  };

  return { nextVersion, proposal: appliedProposal, audit: [audit] };
}

export interface RevertInput {
  /** Every known version of the plan (any order). */
  history: readonly PlanVersion[];
  current: PlanVersion;
  targetVersion: number;
  actor: Actor;
  reason: string;
}

export interface RevertResult {
  nextVersion: PlanVersion;
  audit: AuditEntry[];
}

/**
 * Undo: restores the content of an earlier version as a NEW version (history is never rewritten).
 */
export function revertToVersion(input: RevertInput, ctx: DomainContext): RevertResult {
  const { history, current, targetVersion, actor, reason } = input;

  if (targetVersion === current.version) {
    throw new PlanDomainError("nothing_to_revert", "target version is already the current version");
  }
  const target = history.find((version) => version.planId === current.planId && version.version === targetVersion);
  if (target === undefined) {
    throw new PlanDomainError("unknown_version", `version ${targetVersion} not found in plan history`);
  }

  const now = ctx.now();
  const nextVersion: PlanVersion = {
    id: ctx.newId(),
    planId: current.planId,
    version: current.version + 1,
    parentVersion: current.version,
    createdAt: now,
    createdBy: actor,
    reason,
    sessions: structuredClone(target.sessions),
    proposalId: null,
    revertOf: target.version,
  };

  const audit: AuditEntry = {
    id: ctx.newId(),
    occurredAt: now,
    actor,
    action: "plan_reverted",
    planId: current.planId,
    proposalId: current.proposalId,
    fromVersion: current.version,
    toVersion: nextVersion.version,
    ruleIds: [],
    summary: reason,
    details: { restoredVersion: target.version },
  };

  return { nextVersion, audit: [audit] };
}
