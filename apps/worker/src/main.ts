import { parseWorkerConfig } from "./config";
import { startHealthServer, type HealthState } from "./health";
import { createLogger } from "./logger";
import { createTickLoop } from "./loop";

/**
 * Delivery 1 skeleton: lifecycle, health probe and tick loop only.
 * It connects to no database, sends no notifications and runs no adaptation logic.
 * Job claiming (SKIP LOCKED), Web Push delivery and the adaptive engine arrive in Deliveries 4–6.
 */
async function main(): Promise<void> {
  const config = parseWorkerConfig(process.env);
  const logger = createLogger(config.logLevel);
  const state: HealthState = { startedAt: Date.now(), lastTickAt: null };

  const health = await startHealthServer({
    port: config.healthPort,
    tickSeconds: config.tickSeconds,
    getState: () => state,
  });

  const loop = createTickLoop({
    intervalMs: config.tickSeconds * 1000,
    tick: async () => {
      logger.debug("tick: no job handlers registered yet");
    },
    onError: (error) => logger.error("tick failed", { error: error instanceof Error ? error.message : String(error) }),
    onTickFinished: () => {
      state.lastTickAt = Date.now();
    },
  });

  loop.start();
  logger.info("worker started", { tickSeconds: config.tickSeconds, healthPort: health.port });

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
