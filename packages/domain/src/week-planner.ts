import type { Modality } from "@triatlo/shared";
import { addDaysToDate, localToUtcIso, utcToLocalDate, weekdayOf } from "./time";

/**
 * Places the sessions the USER asked for into the USER's training windows. It decides WHERE and WHEN, never HOW MUCH:
 * counts and durations come from the request, so no training load is invented here.
 */
export interface SessionRequest {
  modality: Modality;
  durationMinutes: number;
  count: number;
  /** Prefer weekend windows (long sessions on days with more time). */
  preferWeekend?: boolean;
}
export interface TrainingWindow { weekday: number; startsAt: string; endsAt: string }
export interface ExistingSlot { startsAt: string; durationMinutes: number }
export interface Placement { modality: Modality; startsAt: string; durationMinutes: number; localDate: string; windowStart: string }
export interface PlanWeekResult { placements: Placement[]; unplaced: Array<{ modality: Modality; durationMinutes: number; reason: string }> }

const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** `weekStart` = local date of the first day of the week (any weekday is fine; 7 days are planned from it). */
export function planWeek(input: {
  weekStart: string;
  timeZone: string;
  requests: readonly SessionRequest[];
  windows: readonly TrainingWindow[];
  existing: readonly ExistingSlot[];
  maxSessionsPerDay?: number;
}): PlanWeekResult {
  const maxPerDay = input.maxSessionsPerDay ?? 1;
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDate(input.weekStart, i));
  // occupied intervals per local day, in minutes from midnight (existing sessions + the ones placed here)
  const busy = new Map<string, Array<[number, number]>>();
  const perDay = new Map<string, number>();
  const modalitiesByDay = new Map<string, Modality[]>();
  for (const e of input.existing) {
    const date = utcToLocalDate(e.startsAt, input.timeZone);
    if (!days.includes(date)) continue;
    const startMin = toMin(new Date(e.startsAt).toLocaleTimeString("en-GB", { timeZone: input.timeZone, hour: "2-digit", minute: "2-digit" }));
    (busy.get(date) ?? busy.set(date, []).get(date)!).push([startMin, startMin + e.durationMinutes]);
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
  }

  const placements: Placement[] = [];
  const unplaced: PlanWeekResult["unplaced"] = [];
  // longest first: they have the fewest places to go
  const queue = input.requests.flatMap((r) => Array.from({ length: r.count }, () => r)).sort((a, b) => b.durationMinutes - a.durationMinutes);

  for (const req of queue) {
    type Candidate = { date: string; start: number; windowStart: string; score: number[] };
    const candidates: Candidate[] = [];
    for (const date of days) {
      if ((perDay.get(date) ?? 0) >= maxPerDay) continue;
      const weekday = weekdayOf(date);
      const isWeekend = weekday === 0 || weekday === 6;
      for (const w of input.windows.filter((x) => x.weekday === weekday)) {
        const ws = toMin(w.startsAt), we = toMin(w.endsAt);
        // first gap inside the window that fits the session and does not overlap anything already there
        for (let start = ws; start + req.durationMinutes <= we; start += 5) {
          const end = start + req.durationMinutes;
          if ((busy.get(date) ?? []).some(([a, b]) => start < b && end > a)) continue;
          const sameModalityAdjacent = [addDaysToDate(date, -1), addDaysToDate(date, 1)].some((d) => (modalitiesByDay.get(d) ?? []).includes(req.modality));
          candidates.push({
            date, start, windowStart: w.startsAt,
            score: [req.preferWeekend ? (isWeekend ? 0 : 1) : (isWeekend ? 1 : 0), perDay.get(date) ?? 0, sameModalityAdjacent ? 1 : 0, days.indexOf(date), start],
          });
          break;
        }
      }
    }
    candidates.sort((a, b) => { for (let i = 0; i < a.score.length; i++) { const d = (a.score[i] as number) - (b.score[i] as number); if (d !== 0) return d; } return 0; });
    const best = candidates[0];
    if (!best) {
      unplaced.push({ modality: req.modality, durationMinutes: req.durationMinutes, reason: "nenhuma janela de treino livre comporta esta sessão" });
      continue;
    }
    (busy.get(best.date) ?? busy.set(best.date, []).get(best.date)!).push([best.start, best.start + req.durationMinutes]);
    perDay.set(best.date, (perDay.get(best.date) ?? 0) + 1);
    (modalitiesByDay.get(best.date) ?? modalitiesByDay.set(best.date, []).get(best.date)!).push(req.modality);
    placements.push({ modality: req.modality, durationMinutes: req.durationMinutes, localDate: best.date, windowStart: best.windowStart, startsAt: localToUtcIso(best.date, fromMin(best.start), input.timeZone) });
  }
  placements.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return { placements, unplaced };
}
