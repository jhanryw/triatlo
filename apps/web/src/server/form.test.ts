import { describe, expect, it } from "vitest";
import { int, num, str } from "./form";

const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.set(k, v); return f; };

describe("form helpers: empty means unknown, never zero", () => {
  it("str trims and turns blank/absent into null", () => {
    expect(str(form({ a: "  oi " }), "a")).toBe("oi");
    expect(str(form({ a: "   " }), "a")).toBeNull();
    expect(str(form({}), "a")).toBeNull();
  });
  it("num keeps a real 0 but never invents one", () => {
    expect(num(form({ a: "0" }), "a")).toBe(0);
    expect(num(form({ a: "" }), "a")).toBeNull();
    expect(num(form({ a: "12,5" }), "a")).toBe(12.5);
    expect(num(form({ a: "abc" }), "a")).toBeNull();
  });
  it("int rounds", () => {
    expect(int(form({ a: "3.6" }), "a")).toBe(4);
    expect(int(form({}), "a")).toBeNull();
  });
});
