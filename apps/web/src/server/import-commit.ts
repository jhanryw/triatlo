import { z } from "zod";
import { MODALITIES } from "@triatlo/shared";
import { type ImportBatch, batchFromAppleHealth, batchFromWorkouts, workoutToInput, type HealthRecord, type ParsedWorkout } from "@triatlo/ingest";

const ParsedWorkoutSchema = z.object({
  format: z.enum(["gpx", "tcx", "apple_health"]), startedAt: z.iso.datetime(), durationSeconds: z.number().nonnegative().nullable(), distanceMeters: z.number().nonnegative().nullable(),
  distanceDerived: z.boolean(), avgHeartRateBpm: z.number().positive().nullable(), maxHeartRateBpm: z.number().positive().nullable(), calories: z.number().nonnegative().nullable(),
  sourceActivityType: z.string().nullable(), modality: z.enum(MODALITIES).nullable(), sourceName: z.string().nullable(),
}).strict();
const RecordSchema = z.object({ type: z.string(), sourceName: z.string(), value: z.string(), unit: z.string().nullable(), startDate: z.string(), endDate: z.string() }).strict();

/** Body of POST /api/import/commit: what the user chose after seeing the inventory. Untrusted: validated. */
export const CommitBodySchema = z.discriminatedUnion("format", [
  z.object({ format: z.literal("apple_health"), fileName: z.string().max(200).nullable(), fileSha256: z.string().length(64), sources: z.array(z.string().min(1)).min(1).max(20),
    modalityChoices: z.record(z.string(), z.enum(MODALITIES)).default({}), staged: z.object({ records: z.array(RecordSchema).max(2_000_000), workouts: z.array(ParsedWorkoutSchema).max(100_000) }).strict() }).strict(),
  z.object({ format: z.enum(["gpx", "tcx"]), fileName: z.string().max(200).nullable(), fileSha256: z.string().length(64),
    /** modality chosen per workout index for activity types the app could not map. */
    modalityByIndex: z.record(z.string(), z.enum(MODALITIES)).default({}), staged: z.object({ workouts: z.array(ParsedWorkoutSchema).min(1).max(1000) }).strict() }).strict(),
]);
export type CommitBody = z.infer<typeof CommitBodySchema>;

export function batchFromCommit(body: CommitBody): { batch: ImportBatch; sourceId: string } {
  if (body.format === "apple_health") {
    return { sourceId: "apple-health-export", batch: batchFromAppleHealth({ records: body.staged.records as HealthRecord[], workouts: body.staged.workouts as ParsedWorkout[] }, new Set(body.sources), body.modalityChoices) };
  }
  const batch: ImportBatch = { workouts: [], sleep: [], observations: [], needsModality: [], warnings: [] };
  (body.staged.workouts as ParsedWorkout[]).forEach((w, i) => {
    const input = workoutToInput(w, body.modalityByIndex[String(i)]);
    if (input) batch.workouts.push(input); else batch.needsModality.push(w);
  });
  if (batch.needsModality.length > 0) batch.warnings.push(`${batch.needsModality.length} treino(s) sem modalidade escolhida não foram importados.`);
  return { sourceId: body.format, batch };
}
export { batchFromWorkouts };
