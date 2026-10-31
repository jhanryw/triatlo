/** Injected so domain functions stay pure and deterministic in tests. */
export interface DomainContext {
  /** Returns a new RFC 4122 uuid. */
  newId(): string;
  /** Returns the current instant as UTC ISO-8601 (e.g. 2026-11-02T09:30:00Z). */
  now(): string;
}
