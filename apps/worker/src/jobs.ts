import type { SupabaseClient } from "@supabase/supabase-js";
import { type DailyRunResult, runDailyAdaptation } from "@triatlo/data";
import { enqueueNotification } from "./notifications";

interface JobRow { id: string; type: string; user_id: string | null; payload: Record<string, unknown>; attempts: number }
export interface JobsSummary { claimed: number; succeeded: number; failed: number; results: Array<{ jobId: string; type: string; outcome: string }> }

/** After an adaptation run, tell the user ONLY what needs them: a proposal to approve, or an automatic (approved) change. No health data in the text. */
export async function notifyAdaptation(db: SupabaseClient, userId: string, run: DailyRunResult, key: string): Promise<void> {
  if (run.status === "proposed") {
    await enqueueNotification(db, { userId, kind: "approval_request", runAt: new Date().toISOString(), idempotencyKey: `approval_request:${key}`, payload: { kind: "approval_request", title: "Ajuste de treino sugerido", body: "Há uma sugestão de ajuste aguardando a sua aprovação.", url: "/", tag: "approval_request" } });
  } else if (run.status === "applied") {
    await enqueueNotification(db, { userId, kind: "plan_change", runAt: new Date().toISOString(), idempotencyKey: `plan_change:${key}`, payload: { kind: "plan_change", title: "Treino ajustado", body: "Seu plano foi ajustado conforme as regras que você aprovou. Veja os detalhes e desfaça se quiser.", url: "/workouts", tag: "plan_change" } });
  }
}

/** Claims due jobs atomically (SKIP LOCKED + lease), runs them, and reports each result back to the queue. */
export async function processJobs(db: SupabaseClient, workerId: string, nowIso: string, limit = 10): Promise<JobsSummary> {
  const claimed = await db.rpc("claim_background_jobs", { p_worker: workerId, p_limit: limit, p_lease_seconds: 300 });
  if (claimed.error) throw new Error(`claim jobs: ${claimed.error.message}`);
  const summary: JobsSummary = { claimed: 0, succeeded: 0, failed: 0, results: [] };
  for (const job of (claimed.data ?? []) as JobRow[]) {
    summary.claimed++;
    try {
      let outcome = "noop";
      if ((job.type === "adapt.daily" || job.type === "adapt.evaluate") && job.user_id) {
        const run = await runDailyAdaptation({ db, userId: job.user_id }, nowIso, `worker:${workerId}`);
        outcome = run.status;
        await notifyAdaptation(db, job.user_id, run, `${job.id}`);
      }
      const done = await db.rpc("complete_background_job", { p_id: job.id, p_worker: workerId });
      if (done.error) throw new Error(done.error.message);
      summary.succeeded++;
      summary.results.push({ jobId: job.id, type: job.type, outcome });
    } catch (e) {
      await db.rpc("fail_background_job", { p_id: job.id, p_worker: workerId, p_error: (e as Error).message, p_retry_in_seconds: 60 });
      summary.failed++;
      summary.results.push({ jobId: job.id, type: job.type, outcome: "failed" });
    }
  }
  return summary;
}
