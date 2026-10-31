import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isActive } from "./nav";

describe("navigation", () => {
  it("exposes the six agreed sections in order (pt-BR labels, English routes)", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Hoje",
      "Treinos",
      "Alimentação",
      "Evolução",
      "Assistente",
      "Configurações",
    ]);
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      "/",
      "/workouts",
      "/nutrition",
      "/progress",
      "/assistant",
      "/settings",
    ]);
  });

  it("has unique hrefs and short labels short enough for a 6-tab bar", () => {
    expect(new Set(NAV_ITEMS.map((item) => item.href)).size).toBe(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) expect(item.shortLabel.length).toBeLessThanOrEqual(10);
  });

  it("marks only the matching section as active", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/workouts", "/")).toBe(false);
    expect(isActive("/workouts", "/workouts")).toBe(true);
    expect(isActive("/workouts/123", "/workouts")).toBe(true);
    expect(isActive("/workoutsX", "/workouts")).toBe(false);
  });
});
