import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health", () => {
  it("answers ok and reports only booleans about configuration (never values)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", service: "triatlo-web", config: { supabaseConfigured: false, pushEnabled: false } });
    expect(Object.keys(body).sort()).toEqual(["commit", "config", "service", "status"]);
  });

  it("detects runtime configuration without exposing it", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://api.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc");
    const text = JSON.stringify(await GET().json());
    expect(text).toContain('"supabaseConfigured":true');
    expect(text).not.toContain("api.example.com");
    expect(text).not.toContain("sb_publishable_abc");
  });
});
