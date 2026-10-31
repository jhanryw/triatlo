import { describe, expect, it } from "vitest";
import { parsePublicConfig } from "./env";
import { parseSupabaseEnv } from "./supabase/env";

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
