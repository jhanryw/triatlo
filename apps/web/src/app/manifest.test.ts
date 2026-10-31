import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

const publicDir = path.join(process.cwd(), "public");

describe("PWA manifest", () => {
  const m = manifest();

  it("is installable as a standalone app (required for iOS Web Push)", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.id).toBe("/");
    expect(m.lang).toBe("pt-BR");
  });

  it("declares 192/512 icons plus a maskable one, and every file exists", () => {
    const sizes = (m.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect((m.icons ?? []).some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of m.icons ?? []) expect(existsSync(path.join(publicDir, icon.src))).toBe(true);
    expect(existsSync(path.join(publicDir, "icons", "apple-touch-icon.png"))).toBe(true);
  });
});
