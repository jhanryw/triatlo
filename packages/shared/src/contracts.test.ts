import { describe, expect, it } from "vitest";
import {
  ApprovalDecisionSchema,
  AuditEntrySchema,
  ChangeProposalSchema,
  NormalizedRecordSchema,
  PlanChangeSchema,
  PlanVersionSchema,
  PlannedSessionSchema,
  PushPayloadSchema,
  PushSubscriptionInputSchema,
  SessionUpdatableFieldsSchema,
  buildIdempotencyKey,
} from "./index";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const T0 = "2026-11-02T09:30:00Z";

const session = {
  id: ID_A,
  modality: "run",
  startsAt: T0,
  durationMinutes: 30,
} as const;

describe("PlannedSession", () => {
  it("applies neutral defaults (planned, no intensity, no targets) and invents nothing else", () => {
    const parsed = PlannedSessionSchema.parse(session);
    expect(parsed.status).toBe("planned");
    expect(parsed.intensity).toBeNull();
    expect(parsed.targets).toEqual([]);
    expect(parsed.objective).toBeNull();
  });

  it("rejects unknown fields and non-positive durations", () => {
    expect(() => PlannedSessionSchema.parse({ ...session, hrZone: 2 })).toThrow();
    expect(() => PlannedSessionSchema.parse({ ...session, durationMinutes: 0 })).toThrow();
  });

  it("covers the six session statuses from the spec", () => {
    for (const status of ["planned", "completed", "partial", "replaced", "rescheduled", "cancelled"]) {
      expect(PlannedSessionSchema.parse({ ...session, status }).status).toBe(status);
    }
    expect(() => PlannedSessionSchema.parse({ ...session, status: "missed" })).toThrow();
  });
});

describe("SessionUpdatableFields", () => {
  it("does not inject defaults into partial updates", () => {
    const parsed = SessionUpdatableFieldsSchema.parse({ durationMinutes: 40 });
    expect(parsed).toEqual({ durationMinutes: 40 });
  });
  it("requires at least one field", () => {
    expect(() => SessionUpdatableFieldsSchema.parse({})).toThrow();
  });
});

describe("PlanVersion / ChangeProposal / Approval / Audit", () => {
  const rationale = { summary: "Move session", dataQuality: "complete" } as const;

  it("parses a plan version", () => {
    const version = PlanVersionSchema.parse({
      id: ID_A,
      planId: ID_B,
      version: 1,
      parentVersion: null,
      createdAt: T0,
      createdBy: { kind: "user" },
      reason: "initial plan",
      sessions: [session],
    });
    expect(version.revertOf).toBeNull();
    expect(version.sessions).toHaveLength(1);
  });

  it("requires at least one change and a rationale on a proposal", () => {
    const base = {
      id: ID_A,
      planId: ID_B,
      baseVersion: 1,
      changeClass: "auto_safe",
      trigger: { type: "event" },
      rationale,
      status: "proposed",
      createdAt: T0,
    };
    const change = { type: "cancel_session", sessionId: ID_C };
    expect(ChangeProposalSchema.parse({ ...base, changes: [change] }).appliedVersion).toBeNull();
    expect(() => ChangeProposalSchema.parse({ ...base, changes: [] })).toThrow();
    expect(() => ChangeProposalSchema.parse({ ...base, changes: [change], rationale: undefined })).toThrow();
  });

  it("only accepts approvals made by the user", () => {
    const approval = { id: ID_A, proposalId: ID_B, decision: "approved", decidedAt: T0 };
    expect(ApprovalDecisionSchema.parse({ ...approval, decidedBy: { kind: "user" } }).decision).toBe("approved");
    expect(() => ApprovalDecisionSchema.parse({ ...approval, decidedBy: { kind: "engine" } })).toThrow();
  });

  it("parses audit entries with structured details", () => {
    const entry = AuditEntrySchema.parse({
      id: ID_A,
      occurredAt: T0,
      actor: { kind: "engine", ref: "rule-set@0" },
      action: "plan_version_applied",
      planId: ID_B,
      summary: "applied",
    });
    expect(entry.details).toEqual({});
  });

  it("discriminates plan changes by type", () => {
    expect(PlanChangeSchema.parse({ type: "reschedule_session", sessionId: ID_A, newStartsAt: T0 }).type).toBe(
      "reschedule_session",
    );
    expect(() => PlanChangeSchema.parse({ type: "increase_load", sessionId: ID_A })).toThrow();
  });
});

describe("job idempotency key", () => {
  const parts = { type: "notification.dispatch", userId: ID_A, entity: "session-1", discriminator: "v3" } as const;
  it("is deterministic", () => {
    expect(buildIdempotencyKey(parts)).toBe(buildIdempotencyKey({ ...parts }));
    expect(buildIdempotencyKey(parts)).toBe(`notification.dispatch:${ID_A}:session-1:v3`);
  });
  it("changes with the entity version (supports supersession)", () => {
    expect(buildIdempotencyKey(parts)).not.toBe(buildIdempotencyKey({ ...parts, discriminator: "v4" }));
  });
  it("rejects ambiguous parts", () => {
    expect(() => buildIdempotencyKey({ ...parts, entity: "a:b" })).toThrow();
    expect(() => buildIdempotencyKey({ ...parts, discriminator: "" })).toThrow();
  });
});

describe("push contracts", () => {
  it("keeps the payload minimal and same-origin", () => {
    const payload = PushPayloadSchema.parse({ kind: "workout_reminder", title: "Treino", body: "Hoje às 18h" });
    expect(payload.url).toBe("/");
    expect(() => PushPayloadSchema.parse({ ...payload, url: "https://evil.example" })).toThrow();
    expect(() => PushPayloadSchema.parse({ ...payload, heartRate: 50 })).toThrow();
  });
  it("validates a serialized subscription", () => {
    const sub = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "k", auth: "a" } };
    expect(PushSubscriptionInputSchema.parse(sub).endpoint).toContain("push.apple.com");
    expect(() => PushSubscriptionInputSchema.parse({ ...sub, keys: { p256dh: "k" } })).toThrow();
  });
});

describe("NormalizedRecord", () => {
  it("keeps missing values null instead of coercing to zero", () => {
    const record = NormalizedRecordSchema.parse({
      sourceKind: "manual",
      sourceId: "manual-form",
      externalId: "x1",
      recordedAt: T0,
      receivedAt: T0,
      kind: "sleep",
      quality: "partial",
      values: { durationMinutes: 450, restingHeartRate: null },
    });
    expect(record.values.restingHeartRate).toBeNull();
  });
});
