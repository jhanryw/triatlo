import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/ctx", () => ({ getSession: async () => session.current }));

import { DELETE, POST } from "./route";

const json = (body: unknown) =>
  new Request("http://localhost/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const valid = {
  subscription: { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "k", auth: "a" } },
  consent: { grantedAt: "2026-11-01T10:00:00Z", userAgent: "test", consentTextVersion: "2026-11-01", displayMode: "standalone" },
};

/** Records every table call; every query resolves to success. */
function fakeSession() {
  const calls: Array<{ table: string; op: string; arg: unknown }> = [];
  const chain = (table: string, op: string, arg: unknown) => {
    calls.push({ table, op, arg });
    const q: Record<string, unknown> = { eq: () => q, then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
    return q;
  };
  const db = { from: (table: string) => ({ delete: () => chain(table, "delete", null), insert: (row: unknown) => chain(table, "insert", row), upsert: (row: unknown) => chain(table, "upsert", row) }) };
  return { calls, session: { ctx: { db, userId: "user-1" }, email: null, timezone: null } };
}

describe("push subscription route", () => {
  beforeEach(() => { session.current = null; });

  it("requires a signed-in user", async () => {
    expect((await POST(json(valid))).status).toBe(401);
    expect((await DELETE(json({ endpoint: valid.subscription.endpoint }))).status).toBe(401);
  });

  it("rejects malformed bodies with 400", async () => {
    session.current = fakeSession().session;
    expect((await POST(json({ nope: true }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/x", { method: "POST", body: "not json" }))).status).toBe(400);
    expect((await DELETE(json({}))).status).toBe(400);
  });

  it("stores the subscription under the caller's user id with the consent evidence", async () => {
    const f = fakeSession();
    session.current = f.session;
    expect((await POST(json(valid))).status).toBe(200);
    const insert = f.calls.find((c) => c.table === "push_subscriptions" && c.op === "insert");
    expect(insert?.arg).toMatchObject({ user_id: "user-1", endpoint: valid.subscription.endpoint, p256dh: "k", auth: "a", display_mode: "standalone", consent_text_version: "2026-11-01" });
    expect(f.calls.some((c) => c.table === "push_subscriptions" && c.op === "delete")).toBe(true);
  });

  it("DELETE removes the endpoint", async () => {
    const f = fakeSession();
    session.current = f.session;
    expect((await DELETE(json({ endpoint: valid.subscription.endpoint }))).status).toBe(200);
    expect(f.calls.at(-1)).toMatchObject({ table: "push_subscriptions", op: "delete" });
  });
});
