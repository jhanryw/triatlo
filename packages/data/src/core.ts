import type { SupabaseClient } from "@supabase/supabase-js";

/** A Supabase client acting as `userId`: the user's session (web) or the service role on behalf of that user (worker). */
export interface Ctx {
  db: SupabaseClient;
  userId: string;
}

export class DataError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "DataError";
  }
}

interface Res<T> { data: T | null; error: { message: string; code?: string } | null }

export function must<T>(res: Res<T>, what: string): T {
  if (res.error) throw new DataError(`${what}: ${res.error.message}`, res.error.code);
  if (res.data === null) throw new DataError(`${what}: no data`);
  return res.data;
}
/** For `.maybeSingle()` results: no row is a valid answer (null). */
export function maybe<T>(res: Res<T>, what: string): T | null {
  if (res.error) throw new DataError(`${what}: ${res.error.message}`, res.error.code);
  return res.data;
}
export function mustOk(res: { error: { message: string; code?: string } | null }, what: string): void {
  if (res.error) throw new DataError(`${what}: ${res.error.message}`, res.error.code);
}

/** timestamptz from PostgREST ("2026-11-03T18:00:00+00:00") -> canonical UTC ISO ("2026-11-03T18:00:00Z"). */
export const isoUtc = (v: string): string => new Date(v).toISOString().replace(".000Z", "Z");
