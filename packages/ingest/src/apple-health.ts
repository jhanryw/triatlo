import { IngestError, type ParsedWorkout } from "./types";
import { attr, modalityFromType, toNumber } from "./util";

/**
 * Apple Health export (`export.xml` from Health → profile → Export All Health Data). Documented, stable format.
 * This is the REAL bridge for Amazfit data: Zepp can write to Apple Health, and `sourceName` tells which app wrote each
 * record. The inventory (counts per source and type) shows exactly what the watch's app provides — nothing is assumed.
 *
 * Streaming: feed chunks with `push()`; elements split across chunks are kept until complete (export files are large).
 */

export interface HealthRecord { type: string; sourceName: string; value: string; unit: string | null; startDate: string; endDate: string }
export interface InventoryRow { sourceName: string; type: string; count: number; first: string; last: string }

const WANTED_RECORDS = new Set([
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKCategoryTypeIdentifierSleepAnalysis",
]);

/** "2026-11-02 07:15:00 -0300" -> { iso, localDate } (the date part is already local in that offset). */
export function parseAppleDate(value: string): { iso: string; localDate: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`);
  if (Number.isNaN(t)) return null;
  return { iso: new Date(t).toISOString().replace(".000Z", "Z"), localDate: m[1] as string };
}

export class AppleHealthScanner {
  private rest = "";
  private invMap = new Map<string, InventoryRow>();
  readonly records: HealthRecord[] = [];
  readonly workouts: ParsedWorkout[] = [];
  elementsSeen = 0;

  push(chunk: string): void {
    const text = this.rest + chunk;
    let i = 0;
    for (;;) {
      const r = text.indexOf("<Record", i), w = text.indexOf("<Workout", i);
      const next = r === -1 ? w : w === -1 ? r : Math.min(r, w);
      if (next === -1) { i = Math.max(i, text.length - 9); break; }          // keep a tail that may hold half a tag name
      const isWorkout = next === w;
      const tagEnd = text.indexOf(">", next);
      if (tagEnd === -1) { i = next; break; }                                // start tag incomplete
      const startTag = text.slice(next, tagEnd + 1);
      let end = tagEnd + 1;
      let body = "";
      if (isWorkout && !startTag.endsWith("/>")) {
        const close = text.indexOf("</Workout>", tagEnd);
        if (close === -1) { i = next; break; }                               // workout body incomplete
        body = text.slice(tagEnd + 1, close);
        end = close + "</Workout>".length;
      }
      this.element(isWorkout, startTag, body);
      i = end;
    }
    this.rest = text.slice(i);
  }

  /** Call after the last chunk. */
  finish(): void {
    if (this.rest.includes("<Record") || this.rest.includes("<Workout")) {
      // a truncated file: the incomplete element is dropped, never guessed
      this.rest = "";
    }
  }

  inventory(): InventoryRow[] {
    return [...this.invMap.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.type.localeCompare(b.type));
  }

  private element(isWorkout: boolean, startTag: string, body: string): void {
    this.elementsSeen++;
    const sourceName = attr(startTag, "sourceName") ?? "(unknown)";
    const type = isWorkout ? `Workout:${attr(startTag, "workoutActivityType") ?? "?"}` : attr(startTag, "type") ?? "?";
    const startDate = attr(startTag, "startDate") ?? "";
    const key = `${sourceName}|${type}`;
    const inv = this.invMap.get(key);
    if (inv) { inv.count++; if (startDate < inv.first) inv.first = startDate; if (startDate > inv.last) inv.last = startDate; }
    else this.invMap.set(key, { sourceName, type, count: 1, first: startDate, last: startDate });

    if (!isWorkout) {
      if (!WANTED_RECORDS.has(type)) return;
      this.records.push({ type, sourceName, value: attr(startTag, "value") ?? "", unit: attr(startTag, "unit"), startDate, endDate: attr(startTag, "endDate") ?? startDate });
      return;
    }
    const start = parseAppleDate(startDate);
    if (!start) return;
    const activity = attr(startTag, "workoutActivityType");
    const duration = toNumber(attr(startTag, "duration"));
    const durUnit = (attr(startTag, "durationUnit") ?? "min").toLowerCase();
    const dist = toNumber(attr(startTag, "totalDistance"));
    const distUnit = (attr(startTag, "totalDistanceUnit") ?? "km").toLowerCase();
    const energy = toNumber(attr(startTag, "totalEnergyBurned"));
    const energyUnit = (attr(startTag, "totalEnergyBurnedUnit") ?? "kcal").toLowerCase();
    const hr = /<WorkoutStatistics\b[^>]*HKQuantityTypeIdentifierHeartRate"[^>]*>/i.exec(body)?.[0] ?? null;
    this.workouts.push({
      format: "apple_health",
      startedAt: start.iso,
      durationSeconds: duration === null ? null : Math.round(durUnit.startsWith("s") ? duration : durUnit.startsWith("h") ? duration * 3600 : duration * 60),
      distanceMeters: dist === null ? null : Math.round(distUnit === "km" ? dist * 1000 : distUnit === "mi" ? dist * 1609.344 : distUnit === "m" ? dist : NaN) || null,
      distanceDerived: false,
      avgHeartRateBpm: hr ? toNumber(attr(hr, "average")) : null,
      maxHeartRateBpm: hr ? toNumber(attr(hr, "maximum")) : null,
      calories: energy === null ? null : energyUnit === "kcal" || energyUnit === "cal" ? energy : null,
      sourceActivityType: activity,
      modality: modalityFromType(activity),
      sourceName,
    });
  }
}

export function scanAppleHealth(xml: string): AppleHealthScanner {
  if (!xml.includes("<HealthData")) throw new IngestError("not an Apple Health export (no <HealthData>)");
  const scanner = new AppleHealthScanner();
  scanner.push(xml);
  scanner.finish();
  return scanner;
}

export interface SleepNight { source: string; nightDate: string; startedAt: string; endedAt: string; asleepMinutes: number; stages: Record<string, number>; extraPeriods: number }
export interface DailyHrv { source: string; day: string; observedAt: string; median: number; samples: number }
export interface DailyRestingHr { source: string; day: string; observedAt: string; value: number }

const median = (v: number[]): number => { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2; };

/** Sleep sessions per source: asleep intervals merged (overlaps counted once), grouped into sessions (gap ≤ 90 min), one night per local end date (the longest). */
export function sleepNights(records: readonly HealthRecord[], sources?: ReadonlySet<string>): SleepNight[] {
  const bySource = new Map<string, Array<{ s: number; e: number; stage: string; endLocal: string; startIso: string; endIso: string }>>();
  for (const r of records) {
    if (r.type !== "HKCategoryTypeIdentifierSleepAnalysis" || (sources && !sources.has(r.sourceName))) continue;
    const a = parseAppleDate(r.startDate), b = parseAppleDate(r.endDate);
    if (!a || !b) continue;
    const stage = r.value.replace("HKCategoryValueSleepAnalysis", "");
    (bySource.get(r.sourceName) ?? bySource.set(r.sourceName, []).get(r.sourceName)!).push({ s: Date.parse(a.iso), e: Date.parse(b.iso), stage, endLocal: b.localDate, startIso: a.iso, endIso: b.iso });
  }
  const nights: SleepNight[] = [];
  for (const [source, intervals] of bySource) {
    const asleep = intervals.filter((x) => x.stage.startsWith("Asleep")).sort((x, y) => x.s - y.s);
    const sessions: typeof asleep[] = [];
    for (const it of asleep) {
      const last = sessions[sessions.length - 1];
      if (last && it.s - (last[last.length - 1] as typeof it).e <= 90 * 60_000) last.push(it); else sessions.push([it]);
    }
    const byDate = new Map<string, SleepNight[]>();
    for (const session of sessions) {
      let merged = 0, cursor = -Infinity;
      for (const it of session) { const from = Math.max(it.s, cursor); if (it.e > from) merged += it.e - from; cursor = Math.max(cursor, it.e); }
      const stages: Record<string, number> = {};
      for (const it of session) stages[it.stage.replace(/^Asleep/, "").toLowerCase() || "unspecified"] = (stages[it.stage.replace(/^Asleep/, "").toLowerCase() || "unspecified"] ?? 0) + Math.round((it.e - it.s) / 60000);
      const last = session[session.length - 1] as typeof session[number];
      const first = session[0] as typeof session[number];
      (byDate.get(last.endLocal) ?? byDate.set(last.endLocal, []).get(last.endLocal)!).push({ source, nightDate: last.endLocal, startedAt: first.startIso, endedAt: last.endIso, asleepMinutes: Math.round(merged / 60000), stages, extraPeriods: 0 });
    }
    for (const list of byDate.values()) {
      const main = [...list].sort((x, y) => y.asleepMinutes - x.asleepMinutes)[0] as SleepNight;
      nights.push({ ...main, extraPeriods: list.length - 1 });
    }
  }
  return nights.sort((x, y) => x.nightDate.localeCompare(y.nightDate));
}

export function restingHeartRates(records: readonly HealthRecord[], sources?: ReadonlySet<string>): DailyRestingHr[] {
  const out = new Map<string, DailyRestingHr>();
  for (const r of records) {
    if (r.type !== "HKQuantityTypeIdentifierRestingHeartRate" || (sources && !sources.has(r.sourceName))) continue;
    const d = parseAppleDate(r.startDate), v = toNumber(r.value);
    if (!d || v === null || v < 0) continue;
    const key = `${r.sourceName}|${d.localDate}`;
    const prev = out.get(key);
    if (!prev || d.iso > prev.observedAt) out.set(key, { source: r.sourceName, day: d.localDate, observedAt: d.iso, value: v });
  }
  return [...out.values()];
}

export function dailyHrv(records: readonly HealthRecord[], sources?: ReadonlySet<string>): DailyHrv[] {
  const groups = new Map<string, { source: string; day: string; first: string; values: number[] }>();
  for (const r of records) {
    if (r.type !== "HKQuantityTypeIdentifierHeartRateVariabilitySDNN" || (sources && !sources.has(r.sourceName))) continue;
    const d = parseAppleDate(r.startDate), v = toNumber(r.value);
    if (!d || v === null || v < 0) continue;
    const key = `${r.sourceName}|${d.localDate}`;
    const g = groups.get(key) ?? { source: r.sourceName, day: d.localDate, first: d.iso, values: [] };
    g.values.push(v); if (d.iso < g.first) g.first = d.iso; groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ source: g.source, day: g.day, observedAt: g.first, median: median(g.values), samples: g.values.length }));
}
