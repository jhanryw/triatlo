import { createClient } from "@supabase/supabase-js";
import { parseWorkerConfig } from "./config";
import { startHealthServer, type HealthState } from "./health";
import { processJobs } from "./jobs";
import { createLogger } from "./logger";
import { createTickLoop } from "./loop";
import { dispatchDueNotifications } from "./notifications";
import { createWebPushSender } from "./push";
import { scheduleDailyAdaptation, scheduleMorningCheckins, scheduleWorkoutReminders } from "./schedule";

/**
 * Worker lifecycle. Each tick: schedule what is due (idempotent), process claimed jobs, deliver due notifications.
 * It talks to Supabase ONLY through the API with the service-role key (backend only); PostgreSQL is not exposed.
 * Without credentials it stays idle and says so — it never pretends to work.
 */
async function main(): Promise<void> {
  const config = parseWorkerConfig(process.env);
  const logger = createLogger(config.logLevel);
  const state: HealthState = { startedAt: Date.now(), lastTickAt: null };
  const workerId = `worker-${process.pid}`;

  const db = config.supabase ? createClient(config.supabase.url, config.supabase.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const sender = config.vapid ? createWebPushSender(config.vapid) : null;
  if (!db) logger.warn("idle: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set, nothing will be scheduled or processed");
  if (db && !sender) logger.warn("push delivery disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT not set");

  const health = await startHealthServer({ port: config.healthPort, tickSeconds: config.tickSeconds, getState: () => state });
  const loop = createTickLoop({
    intervalMs: config.tickSeconds * 1000,
    tick: async () => {
      if (!db) return;
      const now = new Date().toISOString();
      const scheduled = { adapt: await scheduleDailyAdaptation(db, now), checkins: await scheduleMorningCheckins(db, now), reminders: await scheduleWorkoutReminders(db, now) };
      const jobs = await processJobs(db, workerId, now);
      const delivery = sender ? await dispatchDueNotifications(db, now, sender) : null;
      if (scheduled.adapt + scheduled.checkins + scheduled.reminders + jobs.claimed > 0 || (delivery && delivery.sent + delivery.failed > 0)) logger.info("tick", { scheduled, jobs: { claimed: jobs.claimed, succeeded: jobs.succeeded, failed: jobs.failed }, delivery });
    },
    onError: (error) => logger.error("tick failed", { error: error instanceof Error ? error.message : String(error) }),
    onTickFinished: () => { state.lastTickAt = Date.now(); },
  });

  loop.start();
  logger.info("worker started", { tickSeconds: config.tickSeconds, healthPort: health.port, supabase: Boolean(db), push: Boolean(sender) });

  const shutdown = async (signal: string) => {
    logger.info("worker stopping", { signal });
    await loop.stop();
    await health.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", service: "triatlo-worker", message: "fatal", error: String(error) }));
  process.exit(1);
});
