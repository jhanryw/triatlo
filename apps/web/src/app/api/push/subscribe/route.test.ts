import { describe, expect, it } from "vitest";
import { DELETE, POST } from "./route";

const json = (body: unknown) =>
  new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const valid = {
  subscription: { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "k", auth: "a" } },
  consent: {
    grantedAt: "2026-11-01T10:00:00Z",
    userAgent: "test",
    consentTextVersion: "2026-11-01",
    displayMode: "standalone",
  },
};

describe("POST /api/push/subscribe (Delivery 1 stub)", () => {
  it("rejects malformed bodies with 400", async () => {
    expect((await POST(json({ nope: true }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/x", { method: "POST", body: "not json" }))).status).toBe(400);
  });

  it("answers 501 for valid bodies: nothing is stored or sent until Delivery 4", async () => {
    const response = await POST(json(valid));
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: "push_backend_not_configured" });
  });

  it("DELETE validates the endpoint and answers 501", async () => {
    expect((await DELETE(json({}))).status).toBe(400);
    expect((await DELETE(json({ endpoint: "https://web.push.apple.com/abc" }))).status).toBe(501);
  });
});
