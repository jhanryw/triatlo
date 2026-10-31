import { createServer, type Server } from "node:http";

export interface HealthState {
  startedAt: number;
  lastTickAt: number | null;
}

export interface HealthReport {
  status: "ok" | "stale";
  uptimeSeconds: number;
  lastTickAt: string | null;
}

/**
 * Healthy while the loop is alive: either it has not completed its first tick yet (grace of 3 intervals
 * from start) or the last completed tick is recent (within 3 intervals).
 */
export function evaluateHealth(state: HealthState, now: number, tickSeconds: number): HealthReport {
  const maxAgeMs = tickSeconds * 3 * 1000;
  const reference = state.lastTickAt ?? state.startedAt;
  return {
    status: now - reference <= maxAgeMs ? "ok" : "stale",
    uptimeSeconds: Math.floor((now - state.startedAt) / 1000),
    lastTickAt: state.lastTickAt === null ? null : new Date(state.lastTickAt).toISOString(),
  };
}

export interface HealthServer {
  port: number;
  close(): Promise<void>;
}

/** Internal-only HTTP probe for Docker/EasyPanel healthchecks. No public domain should point to it. */
export function startHealthServer(options: {
  port: number;
  tickSeconds: number;
  getState: () => HealthState;
  now?: () => number;
}): Promise<HealthServer> {
  const now = options.now ?? Date.now;
  const server: Server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      const report = evaluateHealth(options.getState(), now(), options.tickSeconds);
      response.writeHead(report.status === "ok" ? 200 : 503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ service: "triatlo-worker", ...report }));
      return;
    }
    response.writeHead(404).end();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolve({
        port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
