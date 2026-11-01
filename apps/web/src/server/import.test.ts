import { describe, expect, it } from "vitest";
import { IngestError } from "@triatlo/ingest";
import { analyzeUpload } from "./import-analyze";
import { CommitBodySchema, batchFromCommit } from "./import-commit";

// FIXTURES: tiny standards-compliant files written for these tests. They are NOT real watch data.
const stream = (text: string, chunk = 64) => {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream<Uint8Array>({ pull(c) { if (i >= bytes.length) { c.close(); return; } c.enqueue(bytes.slice(i, i + chunk)); i += chunk; } });
};
const GPX = `<?xml version="1.0"?><gpx version="1.1" creator="t"><trk><type>running</type><trkseg>
<trkpt lat="1" lon="1"><time>2026-11-02T09:00:00Z</time></trkpt><trkpt lat="1.01" lon="1"><time>2026-11-02T09:30:00Z</time></trkpt></trkseg></trk></gpx>`;
const APPLE = `<?xml version="1.0"?><HealthData locale="pt_BR">
<Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Zepp" unit="count/min" startDate="2026-11-02 00:00:00 -0300" endDate="2026-11-02 00:00:00 -0300" value="52"/>
<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="45" durationUnit="min" sourceName="Zepp" startDate="2026-11-03 18:00:00 -0300" endDate="2026-11-03 18:45:00 -0300"/></HealthData>`;

describe("analyzeUpload", () => {
  it("detects and parses GPX across chunk boundaries and hashes the content", async () => {
    const a = await analyzeUpload(stream(GPX, 17));
    expect(a.format).toBe("gpx");
    expect(a.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.staged.workouts).toHaveLength(1);
    expect(a.staged.workouts[0]?.modality).toBe("run");
  });
  it("inventories an Apple Health export by source so the user can choose", async () => {
    const a = await analyzeUpload(stream(APPLE, 50));
    expect(a.format).toBe("apple_health");
    if (a.format !== "apple_health") return;
    expect(a.inventory.some((r) => r.sourceName === "Zepp")).toBe(true);
    expect(a.staged.workouts).toHaveLength(1);
  });
  it("same bytes, same hash regardless of chunking", async () => {
    expect((await analyzeUpload(stream(GPX, 5))).fileSha256).toBe((await analyzeUpload(stream(GPX, 500))).fileSha256);
  });
  it("refuses content that is not a supported export", async () => {
    await expect(analyzeUpload(stream("<html><body>hello</body></html>".repeat(30)))).rejects.toBeInstanceOf(IngestError);
    await expect(analyzeUpload(stream("plain text"))).rejects.toBeInstanceOf(IngestError);
  });
});

describe("commit body", () => {
  it("round-trips an analysis into an import batch for the chosen source only", async () => {
    const a = await analyzeUpload(stream(APPLE));
    if (a.format !== "apple_health") throw new Error("expected apple_health");
    const body = CommitBodySchema.parse({ format: "apple_health", fileName: "export.xml", fileSha256: a.fileSha256, sources: ["Zepp"], modalityChoices: {}, staged: a.staged });
    const { batch, sourceId } = batchFromCommit(body);
    expect(sourceId).toBe("apple-health-export");
    expect(batch.workouts).toHaveLength(1);
    expect(batchFromCommit(CommitBodySchema.parse({ ...body, sources: ["Other"] })).batch.workouts).toHaveLength(0);
  });
  it("never guesses a modality: unknown types need the user's choice", async () => {
    const yoga = GPX.replace("running", "yoga");
    const a = await analyzeUpload(stream(yoga));
    expect(a.staged.workouts[0]?.modality).toBeNull();
    const base = { format: "gpx" as const, fileName: null, fileSha256: a.fileSha256, staged: a.staged };
    expect(batchFromCommit(CommitBodySchema.parse({ ...base, modalityByIndex: {} })).batch.workouts).toHaveLength(0);
    const chosen = batchFromCommit(CommitBodySchema.parse({ ...base, modalityByIndex: { "0": "recovery" } }));
    expect(chosen.batch.workouts[0]?.modality).toBe("recovery");
  });
  it("rejects malformed or unknown fields", () => {
    expect(CommitBodySchema.safeParse({ format: "pdf" }).success).toBe(false);
    expect(CommitBodySchema.safeParse({ format: "gpx", fileName: null, fileSha256: "short", staged: { workouts: [] } }).success).toBe(false);
  });
});
