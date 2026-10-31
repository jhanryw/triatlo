import { describe, expect, it } from "vitest";
import { parsePublicConfig } from "./env";
import { classifyKey, parseSupabaseEnv } from "./supabase/env";

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
