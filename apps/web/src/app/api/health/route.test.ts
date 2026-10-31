import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("answers ok without leaking configuration", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", service: "triatlo-web" });
    expect(Object.keys(body).sort()).toEqual(["commit", "service", "status"]);
  });
});
