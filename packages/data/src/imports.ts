import type { ImportBatch } from "@triatlo/ingest";
import { type Ctx, must, mustOk } from "./core";

export interface ImportMeta { sourceId: string; fileName: string | null; fileSha256: string | null }
export interface ImportReport { importId: string; received: number; inserted: number; skipped: number; warnings: string[] }

/**
 * Writes a parsed batch with provenance. Re-importing the same real records is a no-op: workouts are de-duplicated by
 * (source, external_id); sleep/observations by their unique keys (an update, not a duplicate).
 */
export async function commitImport(ctx: Ctx, batch: ImportBatch, meta: ImportMeta): Promise<ImportReport> {
  const received = batch.workouts.length + batch.sleep.length + batch.observations.length;
  const created = await ctx.db.from("data_import_provenance").insert({
    user_id: ctx.userId, source_kind: "file_import", source_id: meta.sourceId, file_name: meta.fileName, file_sha256: meta.fileSha256, records_received: received, status: "started",
  }).select("id").single();
  const importId = (must(created, "start import") as { id: string }).id;
  let inserted = 0;
  try {
    if (batch.workouts.length > 0) {
      const ids = batch.workouts.map((w) => w.externalId as string);
      const existing = must(await ctx.db.from("completed_workouts").select("external_id").eq("user_id", ctx.userId).eq("source", "file_import").in("external_id", ids), "check duplicates") as Array<{ external_id: string }>;
      const known = new Set(existing.map((r) => r.external_id));
      const fresh = batch.workouts.filter((w) => !known.has(w.externalId as string));
      for (const w of fresh) {
        mustOk(await ctx.db.from("completed_workouts").insert({
          user_id: ctx.userId, import_id: importId, modality: w.modality, completion: w.completion, started_at: w.startedAt, duration_minutes: w.durationMinutes,
          distance_meters: w.distanceMeters, avg_heart_rate_bpm: w.avgHeartRateBpm, max_heart_rate_bpm: w.maxHeartRateBpm, notes: w.notes, source: "file_import",
          external_id: w.externalId, quality: w.quality,
        }), "insert workout");
        inserted++;
      }
    }
    for (const s of batch.sleep) {
      const before = must(await ctx.db.from("sleep_observations").select("id").eq("user_id", ctx.userId).eq("source", "file_import").eq("night_date", s.nightDate), "check sleep") as unknown[];
      mustOk(await ctx.db.from("sleep_observations").upsert({
        user_id: ctx.userId, import_id: importId, night_date: s.nightDate, started_at: s.startedAt, ended_at: s.endedAt, duration_minutes: s.durationMinutes,
        subjective_quality: s.subjectiveQuality, stages: s.stages, source: "file_import", external_id: s.externalId, quality: s.quality,
      }, { onConflict: "user_id,source,night_date" }), "upsert sleep");
      if (before.length === 0) inserted++;
    }
    for (const o of batch.observations) {
      const before = must(await ctx.db.from("physiological_observations").select("id").eq("user_id", ctx.userId).eq("source", "file_import").eq("metric", o.metric).eq("observed_at", o.observedAt), "check observation") as unknown[];
      mustOk(await ctx.db.from("physiological_observations").upsert({
        user_id: ctx.userId, import_id: importId, metric: o.metric, observed_at: o.observedAt, availability: o.availability, value: o.value, unit: o.unit,
        method: o.method, source: "file_import", external_id: o.externalId, quality: o.quality,
      }, { onConflict: "user_id,source,metric,observed_at" }), "upsert observation");
      if (before.length === 0) inserted++;
    }
    mustOk(await ctx.db.from("data_import_provenance").update({ status: "succeeded", records_inserted: inserted, records_skipped: received - inserted, finished_at: new Date().toISOString() }).eq("id", importId), "finish import");
  } catch (e) {
    await ctx.db.from("data_import_provenance").update({ status: "failed", records_inserted: inserted, error: String((e as Error).message).slice(0, 500), finished_at: new Date().toISOString() }).eq("id", importId);
    throw e;
  }
  return { importId, received, inserted, skipped: received - inserted, warnings: batch.warnings };
}
