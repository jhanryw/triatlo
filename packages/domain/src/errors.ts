export type PlanDomainErrorCode =
  | "plan_mismatch"
  | "stale_base_version"
  | "proposal_not_applicable"
  | "authorization_missing"
  | "unknown_session"
  | "duplicate_session"
  | "unknown_version"
  | "nothing_to_revert";

export class PlanDomainError extends Error {
  readonly code: PlanDomainErrorCode;

  constructor(code: PlanDomainErrorCode, message: string) {
    super(message);
    this.name = "PlanDomainError";
    this.code = code;
  }
}
