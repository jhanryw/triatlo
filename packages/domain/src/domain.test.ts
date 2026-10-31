import { describe, expect, it } from "vitest";
import type { ApprovalDecision, ChangeProposal, PlanVersion, PlannedSession } from "@triatlo/shared";
import {
  DEFAULT_AUTONOMY,
  PlanDomainError,
  applyProposal,
  decideApplication,
  revertToVersion,
  type DomainContext,
} from "./index";

const PLAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";
const user = { kind: "user", ref: null } as const;
const engine = { kind: "engine", ref: "test" } as const;

function makeCtx(): DomainContext {
  let n = 0;
  return {
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    now: () => "2026-11-02T10:00:00Z",
  };
}

const session = (id: string, over: Partial<PlannedSession> = {}): PlannedSession => ({
  id,
  modality: "run",
  objective: null,
  startsAt: "2026-11-03T18:00:00Z",
  durationMinutes: 30,
  intensity: null,
  targets: [],
  instructions: null,
  status: "planned",
  ...over,
});

const v1: PlanVersion = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  planId: PLAN,
  version: 1,
  parentVersion: null,
  createdAt: "2026-11-01T10:00:00Z",
  createdBy: user,
  reason: "initial",
  sessions: [session(S1), session(S2, { modality: "swim" })],
  proposalId: null,
  revertOf: null,
};

const proposal = (over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  planId: PLAN,
  baseVersion: 1,
  changeClass: "auto_safe",
  trigger: { type: "event", ref: null },
  changes: [{ type: "reschedule_session", sessionId: S1, newStartsAt: "2026-11-04T18:00:00Z" }],
  rationale: { summary: "Availability changed", ruleIds: ["rule-x"], dataRefs: [], dataQuality: "complete", caveats: null },
  status: "proposed",
  createdAt: "2026-11-02T09:00:00Z",
  expiresAt: null,
  decidedAt: null,
  appliedVersion: null,
  ...over,
});

const approval = (over: Partial<ApprovalDecision> = {}): ApprovalDecision => ({
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  proposalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  decision: "approved",
  decidedAt: "2026-11-02T09:30:00Z",
  decidedBy: user,
  note: null,
  ...over,
});

describe("decideApplication", () => {
  it("defaults are safe: nothing is applied automatically", () => {
    expect(DEFAULT_AUTONOMY).toEqual({ autoApplyEnabled: false, approvedLimitsVersion: null });
    const decision = decideApplication(proposal(), DEFAULT_AUTONOMY, { withinApprovedLimits: true });
    expect(decision).toEqual({ mode: "await_approval", reason: "auto_apply_disabled" });
  });

  it("never applies load/intensity or structural changes automatically, even with everything enabled", () => {
    const autonomy = { autoApplyEnabled: true, approvedLimitsVersion: "v1" };
    for (const changeClass of ["needs_approval", "structural"] as const) {
      expect(decideApplication(proposal({ changeClass }), autonomy, { withinApprovedLimits: true })).toEqual({
        mode: "await_approval",
        reason: "requires_user_approval",
      });
    }
  });

  it("requires approved limits and a passing guardrail verdict for auto_safe", () => {
    expect(decideApplication(proposal(), { autoApplyEnabled: true, approvedLimitsVersion: null }, { withinApprovedLimits: true }).reason).toBe(
      "limits_not_approved",
    );
    const autonomy = { autoApplyEnabled: true, approvedLimitsVersion: "v1" };
    expect(decideApplication(proposal(), autonomy).reason).toBe("guardrails_not_passed");
    expect(decideApplication(proposal(), autonomy, { withinApprovedLimits: false }).reason).toBe("guardrails_not_passed");
    expect(decideApplication(proposal(), autonomy, { withinApprovedLimits: true })).toEqual({
      mode: "apply",
      reason: "auto_safe_within_limits",
    });
  });

  it("blocks proposals that are not open", () => {
    for (const status of ["approved", "applied", "rejected", "expired", "superseded", "reverted"] as const) {
      expect(decideApplication(proposal({ status }), DEFAULT_AUTONOMY).mode).toBe("blocked");
    }
  });
});

describe("applyProposal", () => {
  const approved = proposal({ status: "approved", changeClass: "needs_approval" });

  it("creates a new version without mutating the previous one, with audit and updated proposal", () => {
    const snapshot = structuredClone(v1);
    const result = applyProposal(
      { current: v1, proposal: approved, basis: { type: "user_approval", approval: approval() }, actor: user },
      makeCtx(),
    );
    expect(v1).toEqual(snapshot);
    expect(result.nextVersion).toMatchObject({ version: 2, parentVersion: 1, planId: PLAN, proposalId: approved.id, revertOf: null });
    expect(result.nextVersion.sessions.find((s) => s.id === S1)?.startsAt).toBe("2026-11-04T18:00:00Z");
    expect(result.nextVersion.sessions.find((s) => s.id === S2)).toEqual(v1.sessions[1]);
    expect(result.proposal).toMatchObject({ status: "applied", appliedVersion: 2 });
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0]).toMatchObject({
      action: "plan_version_applied",
      fromVersion: 1,
      toVersion: 2,
      ruleIds: ["rule-x"],
      details: { basis: "user_approval", changeTypes: ["reschedule_session"], dataQuality: "complete" },
    });
  });

  it("supports update, cancel and add changes", () => {
    const p = proposal({
      status: "approved",
      changes: [
        { type: "update_session", sessionId: S1, fields: { durationMinutes: 45 } },
        { type: "cancel_session", sessionId: S2 },
        { type: "add_session", session: session(S3, { modality: "recovery" }) },
      ],
    });
    const { nextVersion } = applyProposal(
      { current: v1, proposal: p, basis: { type: "user_approval", approval: approval() }, actor: user },
      makeCtx(),
    );
    expect(nextVersion.sessions.find((s) => s.id === S1)).toMatchObject({ durationMinutes: 45, targets: [] });
    expect(nextVersion.sessions.find((s) => s.id === S2)?.status).toBe("cancelled");
    expect(nextVersion.sessions.find((s) => s.id === S3)?.modality).toBe("recovery");
  });

  it("rejects stale base versions, wrong plans and unknown/duplicate sessions", () => {
    const run = (p: ChangeProposal, current = v1) =>
      applyProposal({ current, proposal: p, basis: { type: "user_approval", approval: approval() }, actor: user }, makeCtx());
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error instanceof PlanDomainError ? error.code : "other";
      }
      return "no_error";
    };
    expect(code(() => run(proposal({ status: "approved", baseVersion: 2 })))).toBe("stale_base_version");
    expect(code(() => run(proposal({ status: "approved", planId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })))).toBe("plan_mismatch");
    expect(
      code(() => run(proposal({ status: "approved", changes: [{ type: "cancel_session", sessionId: S3 }] }))),
    ).toBe("unknown_session");
    expect(
      code(() => run(proposal({ status: "approved", changes: [{ type: "add_session", session: session(S1) }] }))),
    ).toBe("duplicate_session");
  });

  it("requires a matching approval from the user for approval-based application", () => {
    const apply = (a: ApprovalDecision, p = approved) =>
      applyProposal({ current: v1, proposal: p, basis: { type: "user_approval", approval: a }, actor: user }, makeCtx());
    expect(() => apply(approval({ decision: "rejected" }))).toThrow(/approval/);
    expect(() => apply(approval({ proposalId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }))).toThrow(/approval/);
    expect(() => apply(approval(), proposal({ status: "proposed" }))).toThrow(PlanDomainError);
  });

  it("allows automatic application only for auto_safe proposals with an 'apply' decision", () => {
    const auto = (p: ChangeProposal, mode: "apply" | "await_approval") =>
      applyProposal(
        { current: v1, proposal: p, basis: { type: "auto_policy", decision: { mode, reason: "auto_safe_within_limits" } }, actor: engine },
        makeCtx(),
      );
    expect(auto(proposal(), "apply").audit[0]?.details).toMatchObject({ basis: "auto_policy" });
    expect(() => auto(proposal(), "await_approval")).toThrow(PlanDomainError);
    expect(() => auto(proposal({ changeClass: "needs_approval" }), "apply")).toThrow(PlanDomainError);
    expect(() => auto(proposal({ changeClass: "structural" }), "apply")).toThrow(PlanDomainError);
  });
});

describe("revertToVersion", () => {
  const ctx = makeCtx();
  const v2 = applyProposal(
    {
      current: v1,
      proposal: proposal({ status: "approved" }),
      basis: { type: "user_approval", approval: approval() },
      actor: user,
    },
    ctx,
  ).nextVersion;

  it("restores an earlier version as a new version and records an audit entry", () => {
    const { nextVersion, audit } = revertToVersion(
      { history: [v1, v2], current: v2, targetVersion: 1, actor: user, reason: "Undo reschedule" },
      ctx,
    );
    expect(nextVersion).toMatchObject({ version: 3, parentVersion: 2, revertOf: 1, proposalId: null });
    expect(nextVersion.sessions).toEqual(v1.sessions);
    expect(nextVersion.sessions).not.toBe(v1.sessions);
    expect(audit[0]).toMatchObject({ action: "plan_reverted", fromVersion: 2, toVersion: 3, details: { restoredVersion: 1 } });
  });

  it("refuses to revert to the current or an unknown version", () => {
    expect(() => revertToVersion({ history: [v1, v2], current: v2, targetVersion: 2, actor: user, reason: "x" }, ctx)).toThrow(/already/);
    expect(() => revertToVersion({ history: [v1, v2], current: v2, targetVersion: 9, actor: user, reason: "x" }, ctx)).toThrow(/not found/);
  });
});
