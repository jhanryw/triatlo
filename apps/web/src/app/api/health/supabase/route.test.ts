import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/health/supabase", () => {
  it("reports not configured without calling the network", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await (await GET()).json()).toEqual({ configured: false, reachable: false, keyAccepted: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probes Auth health with the public key and returns facts only", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://api.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const body = await (await GET()).json();
    expect(fetchSpy).toHaveBeenCalledWith("https://api.example.com/auth/v1/health", expect.objectContaining({ headers: { apikey: "sb_publishable_abc" } }));
    expect(body).toEqual({ configured: true, reachable: true, keyKind: "publishable", authHealthStatus: 200, keyAccepted: true });
    expect(JSON.stringify(body)).not.toContain("example.com");
  });

  it("flags a rejected key and an unreachable gateway", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://api.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 401 }));
    expect(await (await GET()).json()).toMatchObject({ reachable: true, keyAccepted: false, authHealthStatus: 401 });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("down"));
    expect(await (await GET()).json()).toEqual({ configured: true, reachable: false, keyAccepted: false });
  });
});
