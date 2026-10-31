import { z } from "zod";
import { ActorSchema, DataRefSchema, IdSchema, UtcDateTimeSchema } from "./common";
import {
  AUDIT_ACTIONS,
  CHANGE_CLASSES,
  DATA_QUALITIES,
  PROPOSAL_STATUSES,
  TRIGGER_TYPES,
} from "./enums";
import { PlannedSessionSchema, SessionUpdatableFieldsSchema } from "./plan";

/** Structural edits to a plan. They carry no clinical meaning by themselves. */
export const PlanChangeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("reschedule_session"),
      sessionId: IdSchema,
      newStartsAt: UtcDateTimeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("update_session"),
      sessionId: IdSchema,
      fields: SessionUpdatableFieldsSchema,
    })
    .strict(),
  z.object({ type: z.literal("cancel_session"), sessionId: IdSchema }).strict(),
  z.object({ type: z.literal("add_session"), session: PlannedSessionSchema }).strict(),
]);
export type PlanChange = z.infer<typeof PlanChangeSchema>;

/** Why a change was proposed: human summary + rules applied + data used + data quality. */
export const RationaleSchema = z
  .object({
    summary: z.string().min(1),
    ruleIds: z.array(z.string().min(1)).default([]),
    dataRefs: z.array(DataRefSchema).default([]),
    dataQuality: z.enum(DATA_QUALITIES),
    /** Free text for uncertainty and caveats (never a diagnosis). */
    caveats: z.string().min(1).nullable().default(null),
  })
  .strict();
export type Rationale = z.infer<typeof RationaleSchema>;

export const ProposalTriggerSchema = z
  .object({
    type: z.enum(TRIGGER_TYPES),
    ref: z.string().min(1).nullable().default(null),
  })
  .strict();
export type ProposalTrigger = z.infer<typeof ProposalTriggerSchema>;

export const ChangeProposalSchema = z
  .object({
    id: IdSchema,
    planId: IdSchema,
    /** Plan version this proposal was computed against (optimistic concurrency). */
    baseVersion: z.number().int().positive(),
    changeClass: z.enum(CHANGE_CLASSES),
    trigger: ProposalTriggerSchema,
    changes: z.array(PlanChangeSchema).min(1),
    rationale: RationaleSchema,
    status: z.enum(PROPOSAL_STATUSES),
    createdAt: UtcDateTimeSchema,
    expiresAt: UtcDateTimeSchema.nullable().default(null),
    decidedAt: UtcDateTimeSchema.nullable().default(null),
    /** Plan version produced when applied. */
    appliedVersion: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;

export const ApprovalDecisionSchema = z
  .object({
    id: IdSchema,
    proposalId: IdSchema,
    decision: z.enum(["approved", "rejected"]),
    decidedAt: UtcDateTimeSchema,
    decidedBy: ActorSchema.refine((actor) => actor.kind === "user", {
      message: "approvals must come from the user",
    }),
    note: z.string().min(1).nullable().default(null),
  })
  .strict();
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/** Append-only audit record for plan changes (automatic or not). */
export const AuditEntrySchema = z
  .object({
    id: IdSchema,
    occurredAt: UtcDateTimeSchema,
    actor: ActorSchema,
    action: z.enum(AUDIT_ACTIONS),
    planId: IdSchema.nullable(),
    proposalId: IdSchema.nullable().default(null),
    fromVersion: z.number().int().positive().nullable().default(null),
    toVersion: z.number().int().positive().nullable().default(null),
    ruleIds: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1),
    /** Structured details for later inspection. Must not contain secrets. */
    details: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
