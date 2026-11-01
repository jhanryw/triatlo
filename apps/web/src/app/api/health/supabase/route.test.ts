import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;
const clearKeys = () => {
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY",
  ]) vi.stubEnv(name, "");
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/health/supabase", () => {
  it("reports not configured without calling the network", async () => {
    clearKeys();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await (await GET()).json()).toEqual({ configured: false, reachable: false, keyAccepted: false, problem: "missing" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probes Auth health with the public key and returns facts only", async () => {
    clearKeys();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://api.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const body = await (await GET()).json();
    expect(fetchSpy).toHaveBeenCalledWith("https://api.example.com/auth/v1/health", expect.objectContaining({ headers: { apikey: "sb_publishable_abc" } }));
    expect(body).toEqual({ configured: true, reachable: true, keyKind: "publishable", authHealthStatus: 200, keyAccepted: true });
    expect(JSON.stringify(body)).not.toContain("example.com");
  });

  it("accepts the legacy anon JWT used by the Kong-based installation (SUPABASE_ANON_KEY naming too)", async () => {
    clearKeys();
    vi.stubEnv("SUPABASE_URL", "https://api.example.com");
    vi.stubEnv("SUPABASE_ANON_KEY", jwt("anon"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await (await GET()).json()).toMatchObject({ configured: true, keyKind: "legacy_anon", keyAccepted: true });
  });

  it("refuses privileged keys and never calls the network with them", async () => {
    clearKeys();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://api.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", jwt("service_role"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await (await GET()).json()).toMatchObject({ configured: false, problem: "refused_privileged_key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flags a rejected key and an unreachable gateway", async () => {
    clearKeys();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://api.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 401 }));
    expect(await (await GET()).json()).toMatchObject({ reachable: true, keyAccepted: false, authHealthStatus: 401 });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("down"));
    expect(await (await GET()).json()).toEqual({ configured: true, reachable: false, keyAccepted: false });
  });
});
