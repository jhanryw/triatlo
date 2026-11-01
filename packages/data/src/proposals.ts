import { type AdaptationOutcome, type ProposalDraft, DEFAULT_AUTONOMY, applyProposal, decideApplication, revertToVersion, type DomainContext, type AutonomyConfig } from "@triatlo/domain";
import { type ApprovalDecision, type ChangeProposal, type PlanVersion, ChangeProposalSchema } from "@triatlo/shared";
import { randomUUID } from "node:crypto";
import { type Ctx, DataError, isoUtc, maybe, must, mustOk } from "./core";
import { type ActivePlan, commitSessions, ensureActivePlan, loadActivePlan, rowToSession, sessionsToRpc } from "./plan";

const domainCtx: DomainContext = { newId: () => randomUUID(), now: () => new Date().toISOString().replace(".000Z", "Z") };

interface ProposalRow {
  id: string; plan_id: string; base_version: number; change_class: ChangeProposal["changeClass"]; trigger_type: "daily" | "event" | "manual";
  trigger_ref: string | null; changes: ChangeProposal["changes"]; rationale: ChangeProposal["rationale"]; status: ChangeProposal["status"];
  created_at: string; expires_at: string | null; decided_at: string | null; applied_version: number | null;
}

export const rowToProposal = (r: ProposalRow): ChangeProposal =>
  ChangeProposalSchema.parse({
    id: r.id, planId: r.plan_id, baseVersion: r.base_version, changeClass: r.change_class, trigger: { type: r.trigger_type, ref: r.trigger_ref },
    changes: r.changes, rationale: r.rationale, status: r.status, createdAt: isoUtc(r.created_at),
    expiresAt: r.expires_at ? isoUtc(r.expires_at) : null, decidedAt: r.decided_at ? isoUtc(r.decided_at) : null, appliedVersion: r.applied_version,
  });

async function auditRow(ctx: Ctx, row: { action: string; summary: string; actorKind: "user" | "system" | "engine"; actorRef?: string | null; planId?: string; proposalId?: string; ruleIds?: string[]; details?: Record<string, unknown> }) {
  mustOk(await ctx.db.from("adaptation_audit").insert({
    user_id: ctx.userId, actor_kind: row.actorKind, actor_ref: row.actorRef ?? null, action: row.action, plan_id: row.planId ?? null,
    proposal_id: row.proposalId ?? null, rule_ids: row.ruleIds ?? [], summary: row.summary, details: row.details ?? {},
  }), "write audit");
}

export async function insertProposals(ctx: Ctx, drafts: readonly ProposalDraft[], actorRef: string): Promise<ChangeProposal[]> {
  const out: ChangeProposal[] = [];
  for (const d of drafts) {
    const res = await ctx.db.from("workout_change_proposals").insert({
      user_id: ctx.userId, plan_id: d.planId, base_version: d.baseVersion, change_class: d.changeClass, trigger_type: d.trigger.type,
      trigger_ref: d.trigger.ref, changes: d.changes, rationale: d.rationale, status: "proposed",
    }).select("*").single();
    const proposal = rowToProposal(must(res, "insert proposal") as ProposalRow);
    await auditRow(ctx, { action: "proposal_created", summary: d.rationale.summary, actorKind: "engine", actorRef, planId: d.planId, proposalId: proposal.id, ruleIds: d.rationale.ruleIds, details: { changeClass: d.changeClass, dataQuality: d.rationale.dataQuality } });
    out.push(proposal);
  }
  return out;
}

export async function listProposals(ctx: Ctx, statuses: ChangeProposal["status"][] = ["proposed"]): Promise<ChangeProposal[]> {
  const res = await ctx.db.from("workout_change_proposals").select("*").eq("user_id", ctx.userId).in("status", statuses).order("created_at", { ascending: false }).limit(50);
  return (must(res, "list proposals") as ProposalRow[]).map(rowToProposal);
}

async function loadProposal(ctx: Ctx, id: string): Promise<ChangeProposal> {
  const res = await ctx.db.from("workout_change_proposals").select("*").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  const row = maybe(res, "load proposal") as ProposalRow | null;
  if (!row) throw new DataError("proposta não encontrada", "not_found");
  return rowToProposal(row);
}

function planVersionOf(plan: ActivePlan, ownerKind: "user" | "system" | "engine" = "user"): PlanVersion {
  return {
    id: randomUUID(), planId: plan.planId, version: plan.version, parentVersion: plan.version > 1 ? plan.version - 1 : null,
    createdAt: domainCtx.now(), createdBy: { kind: ownerKind, ref: null }, reason: "current", sessions: plan.sessions, proposalId: null, revertOf: null,
  };
}

/** The USER approves: records the decision, then applies it as a new plan version (atomically) — or marks it superseded if the plan moved on. */
export async function approveAndApply(ctx: Ctx, proposalId: string): Promise<{ appliedVersion: number }> {
  const proposal = await loadProposal(ctx, proposalId);
  if (proposal.status !== "proposed") throw new DataError(`proposal is ${proposal.status}, not open`);
  const plan = await loadActivePlan(ctx, proposal.planId);
  if (plan.version !== proposal.baseVersion) {
    mustOk(await ctx.db.from("workout_change_proposals").update({ status: "superseded", decided_at: domainCtx.now() }).eq("id", proposalId), "supersede proposal");
    await auditRow(ctx, { action: "proposal_superseded", summary: "O plano mudou depois desta proposta; ela foi descartada.", actorKind: "system", planId: plan.planId, proposalId });
    throw new DataError("a proposta ficou desatualizada porque o plano mudou", "stale_proposal");
  }
  mustOk(await ctx.db.from("user_approvals").insert({ user_id: ctx.userId, proposal_id: proposalId, decision: "approved" }), "record approval");
  mustOk(await ctx.db.from("workout_change_proposals").update({ status: "approved", decided_at: domainCtx.now() }).eq("id", proposalId), "approve proposal");
  await auditRow(ctx, { action: "proposal_approved", summary: "Aprovada pelo usuário.", actorKind: "user", planId: plan.planId, proposalId });

  const approvedProposal: ChangeProposal = { ...proposal, status: "approved", decidedAt: domainCtx.now() };
  const approval: ApprovalDecision = { id: randomUUID(), proposalId, decision: "approved", decidedAt: domainCtx.now(), decidedBy: { kind: "user", ref: null }, note: null };
  const result = applyProposal({ current: planVersionOf(plan), proposal: approvedProposal, basis: { type: "user_approval", approval }, actor: { kind: "user", ref: null } }, domainCtx);
  const v = await commitSessions(ctx, plan, result.nextVersion.sessions, {
    reason: result.nextVersion.reason, actorKind: "user", proposalId, audit: { action: "plan_version_applied", summary: result.nextVersion.reason, ruleIds: proposal.rationale.ruleIds, details: { basis: "user_approval" } },
  });
  return { appliedVersion: v };
}

export async function rejectProposal(ctx: Ctx, proposalId: string): Promise<void> {
  const proposal = await loadProposal(ctx, proposalId);
  if (proposal.status !== "proposed") throw new DataError(`proposal is ${proposal.status}, not open`);
  mustOk(await ctx.db.from("user_approvals").insert({ user_id: ctx.userId, proposal_id: proposalId, decision: "rejected" }), "record rejection");
  mustOk(await ctx.db.from("workout_change_proposals").update({ status: "rejected", decided_at: domainCtx.now() }).eq("id", proposalId), "reject proposal");
  await auditRow(ctx, { action: "proposal_rejected", summary: "Recusada pelo usuário.", actorKind: "user", planId: proposal.planId, proposalId });
}

/**
 * AUTOMATIC application (worker): only when decideApplication says "apply" — i.e. the proposal is auto_safe AND the user enabled
 * auto-apply AND approved the rule set AND the engine's verdict says it is inside the approved limits. Otherwise it stays open.
 */
export async function applyAutomaticallyIfAllowed(ctx: Ctx, proposal: ChangeProposal, autonomy: AutonomyConfig, withinApprovedLimits: boolean, actorRef: string): Promise<"applied" | "awaiting_approval"> {
  const decision = decideApplication(proposal, autonomy ?? DEFAULT_AUTONOMY, { withinApprovedLimits });
  if (decision.mode !== "apply") return "awaiting_approval";
  const plan = await loadActivePlan(ctx, proposal.planId);
  if (plan.version !== proposal.baseVersion) return "awaiting_approval";
  const result = applyProposal({ current: planVersionOf(plan, "engine"), proposal, basis: { type: "auto_policy", decision }, actor: { kind: "engine", ref: actorRef } }, domainCtx);
  await commitSessions(ctx, plan, result.nextVersion.sessions, {
    reason: result.nextVersion.reason, actorKind: "engine", actorRef, proposalId: proposal.id,
    audit: { action: "plan_version_applied", summary: result.nextVersion.reason, ruleIds: proposal.rationale.ruleIds, details: { basis: "auto_policy", changeClass: proposal.changeClass } },
  });
  return "applied";
}

/** Undo = a NEW version that restores the content of an earlier one. */
export async function undoToVersion(ctx: Ctx, planId: string, targetVersion: number): Promise<number> {
  const plan = await loadActivePlan(ctx, planId);
  const res = await ctx.db.from("training_plan_versions").select("id").eq("plan_id", planId).eq("version", targetVersion).maybeSingle();
  const target = maybe(res, "load target version") as { id: string } | null;
  if (!target) throw new DataError(`versão ${targetVersion} não encontrada`, "not_found");
  const rows = await ctx.db.from("planned_workouts").select("*").eq("plan_version_id", target.id);
  const sessions = (must(rows, "load target sessions") as unknown as Parameters<typeof rowToSession>[0][]).map(rowToSession);
  const history = [{ ...planVersionOf(plan), version: targetVersion, sessions }, planVersionOf(plan)];
  const result = revertToVersion({ history, current: planVersionOf(plan), targetVersion, actor: { kind: "user", ref: null }, reason: `Desfeito: restaurada a versão ${targetVersion}` }, domainCtx);
  return commitSessions(ctx, plan, result.nextVersion.sessions, { reason: result.nextVersion.reason, actorKind: "user", revertOf: targetVersion, audit: { action: "plan_reverted", summary: result.nextVersion.reason, details: { restoredVersion: targetVersion } } });
}

export type { AdaptationOutcome };
export { sessionsToRpc, ensureActivePlan };
