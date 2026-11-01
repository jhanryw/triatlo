import { describe, expect, it } from "vitest";
import { parsePublicConfig } from "./env";
import { classifyKey, inspectSupabaseEnv, parseSupabaseEnv } from "./supabase/env";

describe("parsePublicConfig", () => {
  it("keeps push disabled unless explicitly enabled", () => {
    expect(parsePublicConfig({})).toEqual({ pushEnabled: false, vapidPublicKey: null });
    expect(parsePublicConfig({ pushEnabled: "1", vapidPublicKey: "k" }).pushEnabled).toBe(false);
    expect(parsePublicConfig({ pushEnabled: "true", vapidPublicKey: " k " })).toEqual({
      pushEnabled: true,
      vapidPublicKey: "k",
    });
    expect(parsePublicConfig({ pushEnabled: "true", vapidPublicKey: "  " }).vapidPublicKey).toBeNull();
  });
});

describe("parseSupabaseEnv", () => {
  it("returns null when not configured (the app must run without Supabase)", () => {
    expect(parseSupabaseEnv({})).toBeNull();
    expect(parseSupabaseEnv({ url: "https://api.example.com" })).toBeNull();
    expect(parseSupabaseEnv({ url: "not a url", publishableKey: "k" })).toBeNull();
    expect(parseSupabaseEnv({ url: "", publishableKey: "" })).toBeNull();
  });

  it("returns the public settings when valid", () => {
    expect(parseSupabaseEnv({ url: "https://api.example.com", publishableKey: " pk " })).toEqual({
      url: "https://api.example.com",
      publishableKey: "pk",
    });
  });
});

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;

describe("classifyKey / privileged keys in public settings", () => {
  it("classifies keys by public shape", () => {
    expect(classifyKey("sb_publishable_x")).toBe("publishable");
    expect(classifyKey("sb_secret_x")).toBe("secret");
    expect(classifyKey(jwt("anon"))).toBe("legacy_anon");
    expect(classifyKey(jwt("service_role"))).toBe("legacy_service_role");
    expect(classifyKey("whatever")).toBe("unknown");
  });

  it("refuses a privileged key placed in the public variable (would give every visitor full access)", () => {
    const url = "https://api.example.com";
    expect(parseSupabaseEnv({ url, publishableKey: "sb_secret_abc" })).toBeNull();
    expect(parseSupabaseEnv({ url, publishableKey: jwt("service_role") })).toBeNull();
    expect(parseSupabaseEnv({ url, publishableKey: jwt("anon") })).not.toBeNull();
    expect(parseSupabaseEnv({ url, publishableKey: "sb_publishable_abc" })).not.toBeNull();
  });
});

describe("public demo keys are refused", () => {
  // The demo anon key is PUBLIC (upstream .env.example); rebuilt here from its documented parts so no key is stored in the repo.
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const demoLike = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${b64({ role: "anon", iss: "supabase-demo", iat: 1641769200, exp: 1799535600 })}.sig`;

  it("only sees keys that are exactly the public demo ones as 'demo' (hash match), not look-alikes", () => {
    expect(classifyKey(demoLike)).toBe("legacy_anon");
  });

  it("explains why a configuration was refused, without echoing values", () => {
    const url = "https://api.example.com";
    expect(inspectSupabaseEnv({})).toEqual({ env: null, problem: "missing" });
    expect(inspectSupabaseEnv({ url: "nope", publishableKey: "k" }).problem).toBe("invalid_url");
    expect(inspectSupabaseEnv({ url, publishableKey: "sb_secret_abc" }).problem).toBe("refused_privileged_key");
    expect(inspectSupabaseEnv({ url, publishableKey: "sb_publishable_abc" })).toMatchObject({ problem: null });
  });
});
