import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import type { Ctx } from "./core";

/** Test harness: supabase-js -> path-rewriting proxy -> REAL PostgREST -> REAL PostgreSQL. Used by integration tests only. */
export interface Harness {
  enabled: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  sql(statement: string): string;
  newUser(email: string): string;
  userCtx(id: string): Ctx;
  serviceCtx(id: string): Ctx;
  serviceClient(): Ctx["db"];
}

export function createHarness(env: Record<string, string | undefined> = process.env): Harness {
  const REST = env.TRIATLO_IT_REST_URL, DB = env.TRIATLO_IT_DATABASE_URL, SECRET = env.TRIATLO_IT_JWT_SECRET;
  const enabled = Boolean(REST && DB && SECRET);
  let proxy: Server | undefined;
  let url = "";
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = (claims: Record<string, unknown>) => {
    const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    return `${body}.${createHmac("sha256", SECRET as string).update(body).digest("base64url")}`;
  };
  const clientFor = (token: string) => createClient(url, "anon-key-ignored-by-postgrest", { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const sql = (statement: string) => execFileSync("psql", [DB as string, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8" }).trim();
  return {
    enabled,
    async start() {
      if (!enabled) return;
      proxy = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && !["host", "connection", "content-length"].includes(k)) headers[k] = v;
        const r = await fetch(`${REST}${(req.url ?? "").replace(/^\/rest\/v1/, "")}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method ?? "") ? undefined : Buffer.concat(chunks) });
        const out: Record<string, string> = {};
        r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "content-length"].includes(k)) out[k] = v; });
        res.writeHead(r.status, out);
        res.end(Buffer.from(await r.arrayBuffer()));
      });
      await new Promise<void>((ok) => proxy!.listen(0, "127.0.0.1", ok));
      url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    },
    async stop() { if (proxy) await new Promise((ok) => proxy!.close(ok)); },
    sql,
    newUser(email) { const id = randomUUID(); sql(`insert into auth.users (id, email) values ('${id}', '${email}')`); return id; },
    userCtx: (id) => ({ db: clientFor(jwt({ sub: id, role: "authenticated" })), userId: id }),
    serviceCtx: (id) => ({ db: clientFor(jwt({ role: "service_role" })), userId: id }),
    serviceClient: () => clientFor(jwt({ role: "service_role" })),
  };
}
