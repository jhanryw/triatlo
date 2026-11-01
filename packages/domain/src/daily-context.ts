/**
 * One local day of the shared context (row of the `v_daily_context` view). Every measure is `null` when UNKNOWN —
 * never 0 — and a day with no record at all simply does not appear.
 */
export interface DayContext {
  day: string;
  timezoneAssumed: boolean;
  sleepQualityScore: number | null;
  fatigueScore: number | null;
  energyScore: number | null;
  moodScore: number | null;
  recoveryScore: number | null;
  checkinQuality: "partial" | "complete" | null;
  sleepMinutes: number | null;
  sleepSource: string | null;
  restingHeartRate: number | null;
  hrv: number | null;
  workoutCount: number | null;
  workoutMinutes: number | null;
  workoutsWithoutDuration: number | null;
  mealsLogged: number | null;
  mealsWithEstimate: number | null;
  energyKcalEstimated: number | null;
  intakeRecorded: boolean;
}

/** Row shape returned by PostgREST for `v_daily_context`. */
export interface DailyContextRow {
  day: string;
  timezone_assumed: boolean;
  sleep_quality_score: number | null;
  fatigue_score: number | null;
  energy_score: number | null;
  mood_score: number | null;
  recovery_score: number | null;
  checkin_quality: "partial" | "complete" | null;
  sleep_minutes: number | null;
  sleep_source: string | null;
  resting_heart_rate: number | string | null;
  hrv: number | string | null;
  workout_count: number | null;
  workout_minutes: number | null;
  workouts_without_duration: number | null;
  meals_logged: number | null;
  meals_with_estimate: number | null;
  energy_kcal_estimated: number | string | null;
  intake_recorded: boolean;
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

export function dayContextFromRow(r: DailyContextRow): DayContext {
  return {
    day: r.day,
    timezoneAssumed: r.timezone_assumed,
    sleepQualityScore: r.sleep_quality_score,
    fatigueScore: r.fatigue_score,
    energyScore: r.energy_score,
    moodScore: r.mood_score,
    recoveryScore: r.recovery_score,
    checkinQuality: r.checkin_quality,
    sleepMinutes: r.sleep_minutes,
    sleepSource: r.sleep_source,
    restingHeartRate: num(r.resting_heart_rate),
    hrv: num(r.hrv),
    workoutCount: r.workout_count,
    workoutMinutes: r.workout_minutes,
    workoutsWithoutDuration: r.workouts_without_duration,
    mealsLogged: r.meals_logged,
    mealsWithEstimate: r.meals_with_estimate,
    energyKcalEstimated: num(r.energy_kcal_estimated),
    intakeRecorded: r.intake_recorded,
  };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export type MetricKey = "fatigue" | "energy" | "mood" | "recovery" | "sleepQuality" | "sleepMinutes" | "restingHeartRate";

export function metricValue(day: DayContext, metric: MetricKey): number | null {
  switch (metric) {
    case "fatigue": return day.fatigueScore;
    case "energy": return day.energyScore;
    case "mood": return day.moodScore;
    case "recovery": return day.recoveryScore;
    case "sleepQuality": return day.sleepQualityScore;
    case "sleepMinutes": return day.sleepMinutes;
    case "restingHeartRate": return day.restingHeartRate;
  }
}

/** Fills a date range with the days that exist (absent days stay absent: `undefined`). */
export function indexByDay(days: readonly DayContext[]): Map<string, DayContext> {
  return new Map(days.map((d) => [d.day, d]));
}

/**
 * Intake summary for a day: an ESTIMATE with its completeness. `complete` is only true when every logged meal has an
 * estimate — and even then the numbers are estimates. No recording is NOT "ate nothing".
 */
export function intakeSummary(day: DayContext | undefined): {
  state: "not_recorded" | "recorded_without_estimates" | "partial_estimates" | "estimated";
  energyKcal: number | null;
  mealsLogged: number;
  mealsWithEstimate: number;
} {
  if (!day || !day.intakeRecorded || !day.mealsLogged) return { state: "not_recorded", energyKcal: null, mealsLogged: 0, mealsWithEstimate: 0 };
  const withEstimate = day.mealsWithEstimate ?? 0;
  const state = withEstimate === 0 ? "recorded_without_estimates" : withEstimate < day.mealsLogged ? "partial_estimates" : "estimated";
  return { state, energyKcal: withEstimate === 0 ? null : day.energyKcalEstimated, mealsLogged: day.mealsLogged, mealsWithEstimate: withEstimate };
}
