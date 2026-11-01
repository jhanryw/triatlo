import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_SET_PARAMS, type RuleSetParams } from "@triatlo/shared";
import { evaluateAdaptation, type AdaptationInput, type UpcomingSession } from "./adaptation";
import { type DayContext, intakeSummary, median } from "./daily-context";

const TODAY = "2026-11-20";
const NOW = "2026-11-20T12:00:00Z";
const addDays = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
const day = (date: string, over: Partial<DayContext> = {}): DayContext => ({
  day: date, timezoneAssumed: false, sleepQualityScore: null, fatigueScore: null, energyScore: null, moodScore: null,
  recoveryScore: null, checkinQuality: null, sleepMinutes: null, sleepSource: null, restingHeartRate: null, hrv: null,
  workoutCount: null, workoutMinutes: null, workoutsWithoutDuration: null, mealsLogged: null, mealsWithEstimate: null,
  energyKcalEstimated: null, intakeRecorded: false, ...over,
});
/** 10 baseline days (fatigue 2, energy 4, sleep 450, RHR 55) before the 2-day window, then the given recent days. */
const history = (recent: Array<Partial<DayContext> | null>): DayContext[] => {
  const out: DayContext[] = [];
  for (let i = 12; i >= 3; i--) out.push(day(addDays(TODAY, -i), { fatigueScore: 2, energyScore: 4, sleepMinutes: 450, restingHeartRate: 55, checkinQuality: "partial" }));
  recent.forEach((r, idx) => { if (r) out.push(day(addDays(TODAY, -(recent.length - 1 - idx)), { checkinQuality: "complete", ...r })); });
  return out;
};
const session = (id: string, hoursAhead: number, over: Partial<UpcomingSession> = {}): UpcomingSession => ({
  sessionId: id, modality: "run", startsAt: new Date(Date.parse(NOW) + hoursAhead * 3_600_000).toISOString(), durationMinutes: 60,
  status: "planned", lastChangedAt: null, hasOpenProposal: false, ...over,
});
const run = (days: DayContext[], upcoming: UpcomingSession[], over: Partial<AdaptationInput> = {}, params: RuleSetParams = DEFAULT_RULE_SET_PARAMS) =>
  evaluateAdaptation({ now: NOW, today: TODAY, params, ruleSetVersion: 1, days, upcoming, proposalsLast7Days: 0, planId: "plan-1", baseVersion: 3, ...over });

describe("evaluateAdaptation", () => {
  it("refuses to act without enough real data (no invention)", () => {
    const r = run([day(addDays(TODAY, -1), { fatigueScore: 5 }), day(TODAY, { fatigueScore: 5 })], [session("a", 10)]);
    expect(r.outcome).toBe("insufficient_data");
    if (r.outcome === "insufficient_data") expect(r.knownDays).toBe(2);
  });

  it("does nothing when the person is within their own baseline", () => {
    const r = run(history([{ fatigueScore: 2, energyScore: 4 }, { fatigueScore: 2, energyScore: 4 }]), [session("a", 10)]);
    expect(r.outcome).toBe("no_change");
  });

  it("proposes a conservative duration REDUCTION after a sustained worsening vs the personal baseline", () => {
    const r = run(history([{ fatigueScore: 4 }, { fatigueScore: 4, energyScore: 2 }]), [session("a", 10), session("b", 30)]);
    expect(r.outcome).toBe("proposals");
    if (r.outcome !== "proposals") return;
    expect(r.proposals).toHaveLength(1);                         // ONE proposal: one decision, one plan version
    for (const p of r.proposals) {
      expect(p.sessionIds).toEqual(["a", "b"]);
      expect(p.changes).toHaveLength(2);
      for (const change of p.changes) {
        expect(change.type).toBe("update_session");
        if (change.type === "update_session") expect(change.fields.durationMinutes).toBe(48); // 60 min -20%
      }
      expect(p.changeClass).toBe("auto_safe");
      expect(p.rationale.summary).toMatch(/Reduzir em 20%/);
      expect(p.rationale.ruleIds[0]).toBe("reduce-on-sustained-worsening@rules-v1");
      expect(p.rationale.caveats).toMatch(/não é um diagnóstico/);
      expect(p.baseVersion).toBe(3);
    }
  });

  it("NEVER increases load: every proposed duration is lower than the planned one", () => {
    const r = run(history([{ fatigueScore: 5 }, { fatigueScore: 5 }]), [session("a", 10, { durationMinutes: 90 }), session("b", 20, { durationMinutes: 20 })]);
    if (r.outcome !== "proposals") throw new Error("expected proposals");
    for (const p of r.proposals) {
      for (const c of p.changes) {
        const planned = c.type === "update_session" && c.sessionId === "a" ? 90 : 20;
        if (c.type === "update_session") expect((c.fields.durationMinutes as number) < planned).toBe(true);
      }
    }
  });

  it("a day without data breaks the streak: absence is neither 'fine' nor 'bad'", () => {
    const r = run(history([{ fatigueScore: 5 }, null]), [session("a", 10)]);
    expect(r.outcome).toBe("no_change");
    if (r.outcome === "no_change") expect(r.reasons[0]).toMatch(/sem dados/);
  });

  it("a short-sleep streak alone can trigger (relative to own baseline)", () => {
    const r = run(history([{ sleepMinutes: 300 }, { sleepMinutes: 310 }]), [session("a", 10)]);
    expect(r.outcome).toBe("proposals");
  });

  it("keeps the subjective report when the watch disagrees, and records the conflict", () => {
    const r = run(history([{ fatigueScore: 4, restingHeartRate: 54 }, { fatigueScore: 4, restingHeartRate: 55 }]), [session("a", 10)]);
    expect(r.outcome).toBe("proposals");
    if (r.outcome !== "proposals") return;
    expect(r.signals.conflict).toBe(true);
    expect(r.proposals[0]?.rationale.dataQuality).toBe("conflicting");
    expect(r.proposals[0]?.rationale.caveats).toMatch(/divergem/);
  });

  it("skips ineligible sessions: rest/recovery, cancelled, outside the horizon, open proposal, recently changed, unknown duration", () => {
    const upcoming = [
      session("rest", 10, { modality: "rest" }), session("rec", 10, { modality: "recovery" }), session("cancelled", 10, { status: "cancelled" }),
      session("far", 200), session("past", -2), session("open", 10, { hasOpenProposal: true }),
      session("recent", 10, { lastChangedAt: new Date(Date.parse(NOW) - 3_600_000).toISOString() }), session("nodur", 10, { durationMinutes: null }),
      session("ok", 12),
    ];
    const r = run(history([{ fatigueScore: 4 }, { fatigueScore: 4 }]), upcoming);
    if (r.outcome !== "proposals") throw new Error("expected proposals");
    expect(r.proposals[0]?.sessionIds).toEqual(["ok"]);
  });

  it("labels reductions above the auto limit as needing approval", () => {
    const params: RuleSetParams = { ...DEFAULT_RULE_SET_PARAMS, reduction: { durationFraction: 0.3, maxAutoFraction: 0.2 } };
    const r = run(history([{ fatigueScore: 4 }, { fatigueScore: 4 }]), [session("a", 10)], {}, params);
    if (r.outcome !== "proposals") throw new Error("expected proposals");
    expect(r.proposals[0]?.changeClass).toBe("needs_approval");
  });

  it("respects the weekly proposal cap (stability)", () => {
    const r = run(history([{ fatigueScore: 4 }, { fatigueScore: 4 }]), [session("a", 8), session("b", 16), session("c", 24), session("d", 32)], { proposalsLast7Days: 2 });
    if (r.outcome !== "proposals") throw new Error("expected proposals");
    expect(r.proposals[0]?.sessionIds).toEqual(["a"]);
    const capped = run(history([{ fatigueScore: 4 }, { fatigueScore: 4 }]), [session("a", 8)], { proposalsLast7Days: 3 });
    expect(capped.outcome).toBe("no_change");
  });

  it("does not let the worsening hide inside its own baseline", () => {
    // baseline is computed from days BEFORE the window, so 3 awful days cannot raise their own reference
    const r = run(history([{ fatigueScore: 5 }, { fatigueScore: 5 }]), [session("a", 10)]);
    if (r.outcome !== "proposals") throw new Error("expected proposals");
    expect(r.signals.baselines.fatigue).toBe(2);
  });
});

describe("daily-context helpers", () => {
  it("median handles empty, odd and even sets", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("intake summary never turns 'not recorded' into zero and flags partial estimates", () => {
    expect(intakeSummary(undefined)).toMatchObject({ state: "not_recorded", energyKcal: null });
    expect(intakeSummary(day("d", { intakeRecorded: true, mealsLogged: 2, mealsWithEstimate: 0 }))).toMatchObject({ state: "recorded_without_estimates", energyKcal: null });
    expect(intakeSummary(day("d", { intakeRecorded: true, mealsLogged: 2, mealsWithEstimate: 1, energyKcalEstimated: 600 }))).toMatchObject({ state: "partial_estimates", energyKcal: 600 });
    expect(intakeSummary(day("d", { intakeRecorded: true, mealsLogged: 1, mealsWithEstimate: 1, energyKcalEstimated: 450 }))).toMatchObject({ state: "estimated" });
  });
});
