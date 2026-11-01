import { DEFAULT_RULE_SET_PARAMS, type RuleSetParams, RuleSetParamsSchema, PreferencesSchema, type Preferences } from "@triatlo/shared";
import { type Ctx, maybe, must, mustOk } from "./core";

export interface RuleSet { id: string; version: number; status: "draft" | "approved" | "retired"; params: RuleSetParams; approvedAt: string | null }

const toRuleSet = (r: { id: string; version: number; status: RuleSet["status"]; params: unknown; approved_at: string | null }): RuleSet => ({
  id: r.id, version: r.version, status: r.status, params: RuleSetParamsSchema.parse(r.params), approvedAt: r.approved_at,
});

/** Newest rule set, creating the project's conservative DRAFT (v1) when the user has none. Never approved automatically. */
export async function ensureRuleSet(ctx: Ctx): Promise<RuleSet> {
  const res = await ctx.db.from("training_rule_sets").select("*").eq("user_id", ctx.userId).order("version", { ascending: false }).limit(1);
  const rows = must(res, "load rule sets") as Array<Parameters<typeof toRuleSet>[0]>;
  if (rows[0]) return toRuleSet(rows[0]);
  const created = await ctx.db.from("training_rule_sets").insert({ user_id: ctx.userId, version: 1, params: DEFAULT_RULE_SET_PARAMS, notes: "Rascunho inicial do projeto (v0): inativo até você aprovar." }).select("*").single();
  return toRuleSet(must(created, "create draft rule set") as Parameters<typeof toRuleSet>[0]);
}

export async function getApprovedRuleSet(ctx: Ctx): Promise<RuleSet | null> {
  const res = await ctx.db.from("training_rule_sets").select("*").eq("user_id", ctx.userId).eq("status", "approved").order("version", { ascending: false }).limit(1);
  const rows = must(res, "load approved rule set") as Array<Parameters<typeof toRuleSet>[0]>;
  return rows[0] ? toRuleSet(rows[0]) : null;
}

/** The USER approves a rule set version; optionally enables automatic application of small reductions under it. */
export async function approveRuleSet(ctx: Ctx, ruleSetId: string, opts: { enableAutoApply: boolean }): Promise<void> {
  const res = await ctx.db.from("training_rule_sets").select("version").eq("id", ruleSetId).single();
  const { version } = must(res, "load rule set") as { version: number };
  mustOk(await ctx.db.from("training_rule_sets").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", ruleSetId).eq("user_id", ctx.userId), "approve rule set");
  const prefs = await ctx.db.from("user_preferences").upsert({ user_id: ctx.userId, approved_limits_version: `rules-v${version}`, auto_apply_enabled: opts.enableAutoApply }, { onConflict: "user_id" });
  mustOk(prefs, "save autonomy preferences");
}

export async function getPreferences(ctx: Ctx): Promise<Preferences> {
  const res = await ctx.db.from("user_preferences").select("*").eq("user_id", ctx.userId).maybeSingle();
  const r = maybe(res, "load preferences") as Record<string, unknown> | null;
  return PreferencesSchema.parse(r === null ? {} : {
    weekStartsOn: r.week_starts_on, quietHoursStart: r.quiet_hours_start ? String(r.quiet_hours_start).slice(0, 5) : null,
    quietHoursEnd: r.quiet_hours_end ? String(r.quiet_hours_end).slice(0, 5) : null, notificationsEnabled: r.notifications_enabled,
    aiProcessingConsentAt: r.ai_processing_consent_at ? new Date(r.ai_processing_consent_at as string).toISOString().replace(".000Z", "Z") : null,
    autoApplyEnabled: r.auto_apply_enabled, approvedLimitsVersion: r.approved_limits_version,
  });
}
