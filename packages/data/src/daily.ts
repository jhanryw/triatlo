import { type AdaptationOutcome, type UpcomingSession, evaluateAdaptation, utcToLocalDate, addDaysToDate } from "@triatlo/domain";
import type { ChangeProposal } from "@triatlo/shared";
import type { Ctx } from "./core";
import { loadActivePlan } from "./plan";
import { ensureActivePlan } from "./plan";
import { applyAutomaticallyIfAllowed, insertProposals, listProposals } from "./proposals";
import { getProfile } from "./profile";
import { loadDayContexts } from "./records";
import { getApprovedRuleSet, getPreferences } from "./rules";
import { must } from "./core";

export type DailyRunResult =
  | { status: "timezone_missing" | "rules_not_approved" | "no_plan" }
  | { status: "insufficient_data" | "no_change"; detail: string }
  | { status: "proposed" | "applied"; proposals: ChangeProposal[]; outcome: Extract<AdaptationOutcome, { outcome: "proposals" }> };

/**
 * Daily evaluation for ONE user (also used after relevant events). It acts only if: the user has a timezone, an APPROVED
 * rule set and a plan; and the engine finds sustained worsening vs the person's own baseline. Output is a single
 * proposal; it is applied automatically only if decideApplication allows it, otherwise it waits for the user.
 */
export async function runDailyAdaptation(ctx: Ctx, nowIso: string, actorRef = "worker"): Promise<DailyRunResult> {
  const profile = await getProfile(ctx);
  if (!profile?.timezone) return { status: "timezone_missing" };
  const rules = await getApprovedRuleSet(ctx);
  if (!rules) return { status: "rules_not_approved" };
  const plan = await ensureActivePlan(ctx);
  if (plan.sessions.length === 0) return { status: "no_plan" };

  const today = utcToLocalDate(nowIso, profile.timezone);
  const days = await loadDayContexts(ctx, addDaysToDate(today, -(rules.params.lookbackDays + rules.params.subjective.consecutiveDays)), today);

  const open = await listProposals(ctx, ["proposed"]);
  const sinceIso = new Date(Date.parse(nowIso) - 7 * 86_400_000).toISOString();
  const recent = must(await ctx.db.from("workout_change_proposals").select("status, decided_at, changes, created_at").eq("user_id", ctx.userId).gte("created_at", sinceIso), "load recent proposals") as Array<{ status: string; decided_at: string | null; changes: Array<{ sessionId?: string }>; created_at: string }>;
  const openIds = new Set(open.flatMap((p) => p.changes.map((c) => ("sessionId" in c ? c.sessionId : undefined)).filter((x): x is string => !!x)));
  const lastChanged = new Map<string, string>();
  for (const r of recent.filter((x) => x.status === "applied" && x.decided_at)) {
    for (const c of r.changes) if (c.sessionId) { const prev = lastChanged.get(c.sessionId); if (!prev || (r.decided_at as string) > prev) lastChanged.set(c.sessionId, new Date(r.decided_at as string).toISOString()); }
  }
  const upcoming: UpcomingSession[] = plan.sessions.map((s) => ({
    sessionId: s.id, modality: s.modality, startsAt: s.startsAt, durationMinutes: s.durationMinutes, status: s.status,
    lastChangedAt: lastChanged.get(s.id) ?? null, hasOpenProposal: openIds.has(s.id),
  }));

  const outcome = evaluateAdaptation({ now: nowIso, today, params: rules.params, ruleSetVersion: rules.version, days, upcoming, proposalsLast7Days: recent.length, planId: plan.planId, baseVersion: plan.version });
  if (outcome.outcome === "insufficient_data") return { status: "insufficient_data", detail: outcome.message };
  if (outcome.outcome === "no_change") return { status: "no_change", detail: outcome.reasons.join(" ") };

  const proposals = await insertProposals(ctx, outcome.proposals, actorRef);
  const prefs = await getPreferences(ctx);
  const autonomy = { autoApplyEnabled: prefs.autoApplyEnabled, approvedLimitsVersion: prefs.approvedLimitsVersion === `rules-v${rules.version}` ? prefs.approvedLimitsVersion : null };
  let applied = false;
  for (const p of proposals) {
    // `withinApprovedLimits`: by construction the engine only emits reductions up to the approved fraction, so a proposal
    // labelled auto_safe IS inside the approved limits; anything labelled needs_approval is never auto-applied.
    if ((await applyAutomaticallyIfAllowed(ctx, p, autonomy, p.changeClass === "auto_safe", actorRef)) === "applied") applied = true;
  }
  return { status: applied ? "applied" : "proposed", proposals, outcome };
}

export { loadActivePlan };
