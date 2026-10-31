import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWorkerConfig } from "./config";
import { evaluateHealth, startHealthServer } from "./health";
import { createLogger } from "./logger";
import { createTickLoop } from "./loop";

describe("parseWorkerConfig", () => {
  it("has safe defaults", () => {
    expect(parseWorkerConfig({})).toEqual({ tickSeconds: 30, healthPort: 8081, logLevel: "info" });
  });
  it("parses and validates env", () => {
    expect(parseWorkerConfig({ WORKER_TICK_SECONDS: "10", WORKER_HEALTH_PORT: "9000", LOG_LEVEL: "debug" })).toEqual({
      tickSeconds: 10,
      healthPort: 9000,
      logLevel: "debug",
    });
    expect(() => parseWorkerConfig({ WORKER_TICK_SECONDS: "0" })).toThrow();
    expect(() => parseWorkerConfig({ LOG_LEVEL: "verbose" })).toThrow();
  });
});

describe("createLogger", () => {
  it("emits JSON lines at or above the threshold", () => {
    const lines: string[] = [];
    const logger = createLogger("warn", (line) => lines.push(line));
    logger.info("hidden");
    logger.error("boom", { code: 7 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ level: "error", message: "boom", code: 7, service: "triatlo-worker" });
  });
});

describe("evaluateHealth", () => {
  it("is ok during the start-up grace period and while ticks are recent", () => {
    expect(evaluateHealth({ startedAt: 0, lastTickAt: null }, 60_000, 30).status).toBe("ok");
    expect(evaluateHealth({ startedAt: 0, lastTickAt: 100_000 }, 150_000, 30).status).toBe("ok");
  });
  it("becomes stale when the loop stops ticking", () => {
    expect(evaluateHealth({ startedAt: 0, lastTickAt: null }, 100_000, 30).status).toBe("stale");
    expect(evaluateHealth({ startedAt: 0, lastTickAt: 10_000 }, 200_000, 30).status).toBe("stale");
  });
});

describe("startHealthServer", () => {
  let closeServer: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
  });

  it("serves /healthz with 200 when healthy and 503 when stale, and 404 elsewhere", async () => {
    let now = 1_000;
    const server = await startHealthServer({
      port: 0,
      tickSeconds: 10,
      getState: () => ({ startedAt: 0, lastTickAt: null }),
      now: () => now,
    });
    closeServer = server.close;

    const ok = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ service: "triatlo-worker", status: "ok" });

    now = 1_000_000;
    expect((await fetch(`http://127.0.0.1:${server.port}/healthz`)).status).toBe(503);
    expect((await fetch(`http://127.0.0.1:${server.port}/other`)).status).toBe(404);
  });
});

describe("createTickLoop", () => {
  afterEach(() => vi.useRealTimers());

  it("runs ticks sequentially on the interval and survives errors", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const errors: unknown[] = [];
    const loop = createTickLoop({
      intervalMs: 1000,
      tick: async () => {
        calls += 1;
        if (calls === 2) throw new Error("transient");
      },
      onError: (error) => errors.push(error),
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(3);
    expect(errors).toHaveLength(1);

    await loop.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(3);
  });

  it("never overlaps ticks: the next one is scheduled only after the previous finished", async () => {
    vi.useFakeTimers();
    let active = 0;
    let maxActive = 0;
    const loop = createTickLoop({
      intervalMs: 100,
      tick: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 500));
        active -= 1;
      },
      onError: () => undefined,
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(3000);
    const stopping = loop.stop();
    await vi.advanceTimersByTimeAsync(600); // lets the in-flight tick finish
    await stopping;
    expect(maxActive).toBe(1);
  });
});
