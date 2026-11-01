import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: auth.user } }) } }) }));

import { proxy } from "./proxy";

const call = (path: string) => proxy(new NextRequest(`https://app.example${path}`));
const KEY = ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ role: "anon", iss: "supabase", ref: "x" })).toString("base64url"), "sig"].join(".");

describe("proxy gate", () => {
  beforeEach(() => {
    auth.user = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://api.example.com";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });

  it("sends visitors without a session to /login", async () => {
    const res = await call("/workouts");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.example/login");
  });
  it("answers 401 JSON for API calls instead of redirecting", async () => {
    const res = await call("/api/import/analyze");
    expect(res.status).toBe(401);
  });
  it("keeps login, health probes and PWA assets public", async () => {
    for (const p of ["/login", "/api/health", "/api/health/supabase", "/manifest.webmanifest", "/sw.js", "/icons/a.png"]) {
      const res = await call(p);
      expect(res.status, p).toBe(200);
    }
  });
  it("lets a signed-in user through and bounces them off /login", async () => {
    auth.user = { id: "u" };
    expect((await call("/workouts")).status).toBe(200);
    const res = await call("/login");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.example/");
  });
  it("without usable Supabase config, protected pages go to /login (which explains the problem)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await call("/")).headers.get("location")).toBe("https://app.example/login");
    expect((await call("/login")).status).toBe(200);
  });
});
