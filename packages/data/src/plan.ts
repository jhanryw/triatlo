import type { PlanChange, PlannedSession, SessionStatus, AuditEntry } from "@triatlo/shared";
import { type Ctx, DataError, isoUtc, must, mustOk } from "./core";

interface SessionRow {
  session_id: string; modality: PlannedSession["modality"]; objective: string | null; starts_at: string; duration_minutes: number;
  intensity: PlannedSession["intensity"]; targets: PlannedSession["targets"]; instructions: string | null; status: SessionStatus;
  plan_id: string; plan_version: number;
}

export const rowToSession = (r: SessionRow): PlannedSession => ({
  id: r.session_id, modality: r.modality, objective: r.objective, startsAt: isoUtc(r.starts_at), durationMinutes: r.duration_minutes,
  intensity: r.intensity ?? null, targets: r.targets ?? [], instructions: r.instructions, status: r.status,
});

export const sessionsToRpc = (sessions: readonly PlannedSession[]) =>
  sessions.map((s) => ({
    session_id: s.id, modality: s.modality, objective: s.objective, starts_at: s.startsAt, duration_minutes: s.durationMinutes,
    intensity: s.intensity, targets: s.targets, instructions: s.instructions, status: s.status,
  }));

export interface ActivePlan { planId: string; version: number; sessions: PlannedSession[] }

/** The active plan with the sessions of its latest version. Creates an empty plan (version 1) when none exists. */
export async function ensureActivePlan(ctx: Ctx): Promise<ActivePlan> {
  const existing = await ctx.db.from("training_plans").select("id").eq("user_id", ctx.userId).eq("status", "active").order("created_at", { ascending: true }).limit(1);
  let planId = (must(existing, "load plan") as Array<{ id: string }>)[0]?.id;
  if (!planId) {
    const created = await ctx.db.from("training_plans").insert({ user_id: ctx.userId, name: "Plano de treino" }).select("id").single();
    planId = must(created, "create plan").id as string;
    await commitSessions(ctx, { planId, version: 0 }, [], { reason: "Plano criado", actorKind: "user", audit: { action: "plan_created", summary: "Plano criado" } });
  }
  return loadActivePlan(ctx, planId);
}

export async function loadActivePlan(ctx: Ctx, planId: string): Promise<ActivePlan> {
  const res = await ctx.db.from("v_current_planned_workouts").select("*").eq("plan_id", planId).order("starts_at", { ascending: true });
  const rows = must(res, "load sessions") as SessionRow[];
  if (rows.length > 0) return { planId, version: rows[0]!.plan_version, sessions: rows.map(rowToSession) };
  const v = await ctx.db.from("training_plan_versions").select("version").eq("plan_id", planId).order("version", { ascending: false }).limit(1);
  return { planId, version: (must(v, "load version") as Array<{ version: number }>)[0]?.version ?? 0, sessions: [] };
}

export interface CommitOptions {
  reason: string;
  actorKind: "user" | "system" | "engine";
  actorRef?: string | null;
  proposalId?: string | null;
  revertOf?: number | null;
  audit: { action: AuditEntry["action"]; summary: string; ruleIds?: string[]; details?: Record<string, unknown> };
}

/** Atomic: new immutable version + (optional) proposal marked applied + audit row. Fails with DataError code 40001 if stale. */
export async function commitSessions(ctx: Ctx, plan: { planId: string; version: number }, sessions: readonly PlannedSession[], opts: CommitOptions): Promise<number> {
  const res = await ctx.db.rpc("commit_plan_version", {
    p_plan_id: plan.planId,
    p_expected_version: plan.version === 0 ? null : plan.version,
    p_reason: opts.reason,
    p_actor_kind: opts.actorKind,
    p_actor_ref: opts.actorRef ?? null,
    p_proposal_id: opts.proposalId ?? null,
    p_revert_of: opts.revertOf ?? null,
    p_sessions: sessionsToRpc(sessions),
    p_audit: { action: opts.audit.action, summary: opts.audit.summary, rule_ids: opts.audit.ruleIds ?? [], details: opts.audit.details ?? {} },
  });
  return must(res, "commit plan version") as number;
}

/** User-driven change of the plan (manual edits): same versioning, actor = user. */
export async function applyUserChanges(ctx: Ctx, changes: readonly PlanChange[], summary: string): Promise<ActivePlan> {
  const plan = await ensureActivePlan(ctx);
  let sessions = [...plan.sessions];
  for (const c of changes) {
    switch (c.type) {
      case "add_session": sessions.push(c.session); break;
      case "cancel_session": sessions = sessions.map((s) => (s.id === c.sessionId ? { ...s, status: "cancelled" as const } : s)); break;
      case "reschedule_session": sessions = sessions.map((s) => (s.id === c.sessionId ? { ...s, startsAt: c.newStartsAt } : s)); break;
      case "update_session": {
        const defined = Object.fromEntries(Object.entries(c.fields).filter(([, v]) => v !== undefined));
        sessions = sessions.map((s) => (s.id === c.sessionId ? { ...s, ...defined } : s));
        break;
      }
    }
    if ("sessionId" in c && !plan.sessions.some((s) => s.id === c.sessionId)) throw new DataError(`session ${c.sessionId} not found in the current plan`);
  }
  await commitSessions(ctx, plan, sessions, { reason: summary, actorKind: "user", audit: { action: "plan_version_applied", summary, details: { changeTypes: changes.map((c) => c.type), manual: true } } });
  return loadActivePlan(ctx, plan.planId);
}

/** Marks a session done/partial/etc. as a new version (history keeps the old one). */
export async function setSessionStatus(ctx: Ctx, sessionId: string, status: SessionStatus, summary: string): Promise<void> {
  const plan = await ensureActivePlan(ctx);
  if (!plan.sessions.some((s) => s.id === sessionId)) throw new DataError(`session ${sessionId} not found in the current plan`);
  await commitSessions(ctx, plan, plan.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s)), {
    reason: summary, actorKind: "user", audit: { action: "plan_version_applied", summary, details: { sessionId, status } },
  });
}

export async function listPlanHistory(ctx: Ctx, planId: string, limit = 20) {
  const res = await ctx.db.from("training_plan_versions").select("version, reason, created_by_kind, created_by_ref, created_at, proposal_id, revert_of").eq("plan_id", planId).order("version", { ascending: false }).limit(limit);
  return must(res, "load plan history");
}

export async function listAudit(ctx: Ctx, limit = 30) {
  const res = await ctx.db.from("adaptation_audit").select("*").eq("user_id", ctx.userId).order("occurred_at", { ascending: false }).limit(limit);
  return must(res, "load audit");
}

export { mustOk };
