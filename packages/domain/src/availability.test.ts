import { describe, expect, it } from "vitest";
import { averageOfKnown, dateRange, dayStatuses, measureState } from "./availability";

describe("dateRange", () => {
  it("is inclusive and crosses month/leap boundaries", () => {
    expect(dateRange("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(dateRange("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(dateRange("2026-11-02", "2026-11-02")).toEqual(["2026-11-02"]);
  });
  it("rejects invalid input", () => {
    expect(() => dateRange("2026-13-01", "2026-13-02")).toThrow();
    expect(() => dateRange("2026-02-30", "2026-03-01")).toThrow();
    expect(() => dateRange("2026-11-03", "2026-11-02")).toThrow();
  });
});

describe("dayStatuses", () => {
  it("separates absent, partial and complete days", () => {
    const result = dayStatuses({ from: "2026-11-01", to: "2026-11-04" }, [
      { date: "2026-11-01", quality: "partial" },
      { date: "2026-11-03", quality: "complete" },
    ]);
    expect(result).toEqual([
      { date: "2026-11-01", state: "partial" },
      { date: "2026-11-02", state: "absent" },
      { date: "2026-11-03", state: "complete" },
      { date: "2026-11-04", state: "absent" },
    ]);
  });
  it("ignores records outside the range", () => {
    expect(dayStatuses({ from: "2026-11-01", to: "2026-11-01" }, [{ date: "2026-10-31", quality: "complete" }])).toEqual([
      { date: "2026-11-01", state: "absent" },
    ]);
  });
});

describe("measureState / averageOfKnown", () => {
  it("never confuses unknown with zero", () => {
    expect(measureState(null)).toBe("unknown");
    expect(measureState(undefined)).toBe("unknown");
    expect(measureState(0)).toBe("zero");
    expect(measureState(42)).toBe("value");
  });
  it("averages only known values and reports how many contributed", () => {
    expect(averageOfKnown([null, undefined])).toEqual({ average: null, known: 0, total: 2 });
    expect(averageOfKnown([0, null, 6])).toEqual({ average: 3, known: 2, total: 3 });
  });
});
