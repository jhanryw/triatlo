/**
 * Availability helpers: show missing data as MISSING, never as zero (spec §6/§7, DOMAIN_MODEL §5).
 * Pure functions over local calendar dates ("YYYY-MM-DD"); no timezone logic lives here.
 */

export type DayState = "absent" | "partial" | "complete";

export interface DayStatus {
  date: string;
  state: DayState;
}

const DAY_MS = 86_400_000;

function parseUtcDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`invalid local date: ${date}`);
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== date) throw new Error(`invalid local date: ${date}`);
  return ms;
}

/** Every date from `from` to `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const start = parseUtcDate(from);
  const end = parseUtcDate(to);
  if (end < start) throw new Error("range end is before its start");
  const out: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * One status per day of the range: `absent` when there is no record at all, otherwise the record's own quality
 * ('partial' | 'complete'). A day with a record is never reported as absent and vice versa.
 */
export function dayStatuses(
  range: { from: string; to: string },
  records: ReadonlyArray<{ date: string; quality: "partial" | "complete" }>,
): DayStatus[] {
  const byDate = new Map<string, "partial" | "complete">();
  for (const record of records) byDate.set(record.date, record.quality);
  return dateRange(range.from, range.to).map((date) => ({ date, state: byDate.get(date) ?? "absent" }));
}

export type MeasureState = "unknown" | "zero" | "value";

/** null/undefined = unknown (no measurement); 0 = a real zero; anything else = a value. */
export function measureState(value: number | null | undefined): MeasureState {
  if (value === null || value === undefined) return "unknown";
  return value === 0 ? "zero" : "value";
}

/**
 * Average over the KNOWN values only. Returns null (not 0) when nothing is known, and reports how many days contributed,
 * so callers can refuse conclusions from insufficient data.
 */
export function averageOfKnown(values: ReadonlyArray<number | null | undefined>): { average: number | null; known: number; total: number } {
  const known = values.filter((v): v is number => typeof v === "number");
  return {
    average: known.length === 0 ? null : known.reduce((sum, v) => sum + v, 0) / known.length,
    known: known.length,
    total: values.length,
  };
}
