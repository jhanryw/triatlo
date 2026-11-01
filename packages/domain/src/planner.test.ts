import { describe, expect, it } from "vitest";
import { localToUtcIso, utcToLocalDate, weekdayOf, addDaysToDate } from "./time";
import { planWeek, type TrainingWindow } from "./week-planner";
import { mealTotals, scaleItem } from "./nutrition";

describe("time zones", () => {
  it("converts local wall-clock to UTC, including DST", () => {
    expect(localToUtcIso("2026-11-02", "06:30", "America/Sao_Paulo")).toBe("2026-11-02T09:30:00Z");            // UTC-3, no DST
    expect(localToUtcIso("2026-07-01", "06:30", "America/New_York")).toBe("2026-07-01T10:30:00Z");            // EDT -4
    expect(localToUtcIso("2026-12-01", "06:30", "America/New_York")).toBe("2026-12-01T11:30:00Z");            // EST -5
    expect(localToUtcIso("2026-03-08", "03:30", "America/New_York")).toBe("2026-03-08T07:30:00Z");            // right after the spring-forward
  });
  it("finds the local date across UTC midnight", () => {
    expect(utcToLocalDate("2026-11-03T02:30:00Z", "America/Sao_Paulo")).toBe("2026-11-02");
    expect(utcToLocalDate("2026-11-03T02:30:00Z", "UTC")).toBe("2026-11-03");
    expect(weekdayOf("2026-11-02")).toBe(1);
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("planWeek", () => {
  const windows: TrainingWindow[] = [
    { weekday: 1, startsAt: "06:00", endsAt: "07:00" }, { weekday: 3, startsAt: "06:00", endsAt: "07:00" }, { weekday: 5, startsAt: "06:00", endsAt: "07:00" },
    { weekday: 6, startsAt: "07:00", endsAt: "10:00" }, { weekday: 0, startsAt: "07:00", endsAt: "10:00" },
  ];
  const base = { weekStart: "2026-11-02", timeZone: "America/Sao_Paulo", windows, existing: [] };

  it("places exactly what was requested inside the windows, one per day, long sessions on the weekend", () => {
    const r = planWeek({ ...base, requests: [
      { modality: "run", durationMinutes: 40, count: 2 }, { modality: "swim", durationMinutes: 45, count: 1 }, { modality: "bike_indoor", durationMinutes: 120, count: 1, preferWeekend: true },
    ] });
    expect(r.unplaced).toEqual([]);
    expect(r.placements).toHaveLength(4);
    expect(new Set(r.placements.map((p) => p.localDate)).size).toBe(4);               // max 1 per day
    const long = r.placements.find((p) => p.durationMinutes === 120);
    expect([0, 6]).toContain(weekdayOf(long?.localDate as string));
    for (const p of r.placements) expect(p.startsAt).toMatch(/Z$/);
  });

  it("reports what does not fit instead of squeezing or inventing slots", () => {
    const r = planWeek({ ...base, requests: [{ modality: "run", durationMinutes: 200, count: 1 }, { modality: "swim", durationMinutes: 45, count: 7 }] });
    expect(r.unplaced.find((u) => u.durationMinutes === 200)?.reason).toMatch(/nenhuma janela/);
    expect(r.placements.length).toBeLessThanOrEqual(5);                               // only 5 windows exist
    expect(r.unplaced.length).toBeGreaterThan(1);
  });

  it("does not overlap existing sessions and respects the per-day limit", () => {
    const existing = [{ startsAt: localToUtcIso("2026-11-02", "06:00", "America/Sao_Paulo"), durationMinutes: 60 }];
    const r = planWeek({ ...base, existing, requests: [{ modality: "run", durationMinutes: 30, count: 1 }] });
    expect(r.placements[0]?.localDate).not.toBe("2026-11-02");
  });

  it("is deterministic", () => {
    const req = [{ modality: "run" as const, durationMinutes: 40, count: 2 }];
    expect(planWeek({ ...base, requests: req })).toEqual(planWeek({ ...base, requests: req }));
  });
});

describe("nutrition totals", () => {
  const item = (e: number | null, p: number | null = null) => ({ energyKcal: e, proteinG: p, carbohydrateG: null, fatG: null });
  it("sums a nutrient only when every item has it (no partial sums disguised as totals)", () => {
    const t = mealTotals([item(190, 4), item(120, null)]);
    expect(t.energyKcal).toBe(310);
    expect(t.proteinG).toBeNull();
    expect(t.incomplete).toContain("proteinG");
    expect(mealTotals([]).energyKcal).toBeNull();
  });
  it("keeps zero distinct from unknown", () => {
    expect(mealTotals([item(0), item(0)]).energyKcal).toBe(0);
    expect(mealTotals([item(0), item(null)]).energyKcal).toBeNull();
  });
  it("scales an item proportionally and leaves unknown values unknown", () => {
    expect(scaleItem({ energyKcal: 200, proteinG: null, carbohydrateG: 40, fatG: 0 }, 1.5)).toEqual({ energyKcal: 300, proteinG: null, carbohydrateG: 60, fatG: 0 });
    expect(() => scaleItem(item(1), -1)).toThrow();
  });
});
