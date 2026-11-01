import {
  CompletedWorkoutInputSchema,
  PhysiologicalObservationInputSchema,
  SleepObservationInputSchema,
  type CompletedWorkoutInput,
} from "@triatlo/shared";
import { type AppleHealthScanner, dailyHrv, restingHeartRates, sleepNights } from "./apple-health";
import type { ImportBatch, ParsedWorkout } from "./types";
import { sha256 } from "./util";

const SOURCE_KIND = "file_import" as const;

/** Stable id for idempotent re-imports of the same real activity. */
export function workoutExternalId(w: ParsedWorkout): string {
  return sha256([w.format, w.sourceName ?? "", w.startedAt, w.durationSeconds ?? "", w.distanceMeters ?? ""].join("|")).slice(0, 32);
}

export function workoutToInput(w: ParsedWorkout, modalityOverride?: CompletedWorkoutInput["modality"]): CompletedWorkoutInput | null {
  const modality = modalityOverride ?? w.modality;
  if (modality === null) return null;
  const minutes = w.durationSeconds === null ? null : Math.round(w.durationSeconds / 60);
  const origin = [w.sourceName ? `Origem: ${w.sourceName}` : null, w.sourceActivityType ? `tipo no arquivo: ${w.sourceActivityType}` : null, w.distanceDerived ? "distância calculada a partir dos pontos do trajeto" : null]
    .filter((x): x is string => x !== null).join("; ");
  return CompletedWorkoutInputSchema.parse({
    modality,
    completion: "completed",
    startedAt: w.startedAt,
    durationMinutes: minutes !== null && minutes >= 1 ? minutes : null,
    distanceMeters: w.distanceMeters,
    avgHeartRateBpm: w.avgHeartRateBpm,
    maxHeartRateBpm: w.maxHeartRateBpm,
    notes: origin || null,
    source: SOURCE_KIND,
    externalId: workoutExternalId(w),
    quality: minutes !== null && minutes >= 1 ? "complete" : "partial",
  });
}

/** Workouts from GPX/TCX files. Unmapped activity types are returned in needsModality (the user must choose). */
export function batchFromWorkouts(workouts: readonly ParsedWorkout[]): ImportBatch {
  const batch: ImportBatch = { workouts: [], sleep: [], observations: [], needsModality: [], warnings: [] };
  for (const w of workouts) {
    const input = workoutToInput(w);
    if (input) batch.workouts.push(input);
    else batch.needsModality.push(w);
  }
  if (batch.needsModality.length > 0) batch.warnings.push(`${batch.needsModality.length} treino(s) com tipo desconhecido: escolha a modalidade antes de importar.`);
  return batch;
}

/** Everything importable from an Apple Health export for the CHOSEN sources (e.g. the watch app). */
export function batchFromAppleHealth(scan: Pick<AppleHealthScanner, "records" | "workouts">, sources: ReadonlySet<string>, modalityChoices: Readonly<Record<string, CompletedWorkoutInput["modality"]>> = {}): ImportBatch {
  const batch: ImportBatch = { workouts: [], sleep: [], observations: [], needsModality: [], warnings: [] };
  const wanted = scan.workouts.filter((w) => w.sourceName !== null && sources.has(w.sourceName));
  for (const w of wanted) {
    const input = workoutToInput(w, w.sourceActivityType ? modalityChoices[w.sourceActivityType] : undefined);
    if (input) batch.workouts.push(input);
    else batch.needsModality.push(w);
  }
  for (const n of sleepNights(scan.records, sources)) {
    batch.sleep.push(
      SleepObservationInputSchema.parse({
        nightDate: n.nightDate, startedAt: n.startedAt, endedAt: n.endedAt, durationMinutes: n.asleepMinutes,
        stages: { minutes: n.stages, origin: n.source },
        source: SOURCE_KIND, externalId: sha256(`apple-sleep|${n.source}|${n.nightDate}`).slice(0, 32),
        quality: "complete",
      }),
    );
    if (n.extraPeriods > 0) batch.warnings.push(`${n.nightDate}: ${n.extraPeriods} período(s) de sono adicional (cochilos) não incluído(s); foi usado o mais longo.`);
  }
  for (const r of restingHeartRates(scan.records, sources)) {
    batch.observations.push(
      PhysiologicalObservationInputSchema.parse({
        metric: "resting_heart_rate", observedAt: r.observedAt, availability: "available", value: r.value, unit: "bpm",
        method: `Apple Health (${r.source})`, source: SOURCE_KIND, externalId: sha256(`apple-rhr|${r.source}|${r.day}`).slice(0, 32),
      }),
    );
  }
  for (const h of dailyHrv(scan.records, sources)) {
    batch.observations.push(
      PhysiologicalObservationInputSchema.parse({
        metric: "heart_rate_variability", observedAt: h.observedAt, availability: "available", value: Math.round(h.median * 10) / 10, unit: "ms",
        method: `SDNN, mediana de ${h.samples} amostra(s) do dia (Apple Health, ${h.source}); não comparável a outras definições de HRV`,
        source: SOURCE_KIND, externalId: sha256(`apple-hrv|${h.source}|${h.day}`).slice(0, 32),
      }),
    );
  }
  if (batch.needsModality.length > 0) batch.warnings.push(`${batch.needsModality.length} treino(s) com tipo desconhecido: escolha a modalidade antes de importar.`);
  return batch;
}
