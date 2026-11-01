import { createHash } from "node:crypto";
import { AppleHealthScanner, type HealthRecord, type InventoryRow, IngestError, type ParsedWorkout, parseGpx, parseTcx } from "@triatlo/ingest";

/** Maximum size accepted for a single uploaded file (Apple Health exports are the large ones). */
export const MAX_IMPORT_BYTES = 600 * 1024 * 1024;
const MAX_SMALL_FILE_BYTES = 25 * 1024 * 1024;

const detect = (head: string): "apple_health" | "gpx" | "tcx" | null =>
  /<HealthData[\s>]/i.test(head) ? "apple_health" : /<gpx[\s>]/i.test(head) ? "gpx" : /<TrainingCenterDatabase[\s>]/i.test(head) ? "tcx" : null;
/** The root tag must show up within this many characters, otherwise the file is not one of ours. */
const SNIFF_LIMIT = 8192;

export type AnalyzedUpload =
  | { format: "apple_health"; fileSha256: string; bytes: number; inventory: InventoryRow[]; staged: { records: HealthRecord[]; workouts: ParsedWorkout[] } }
  | { format: "gpx" | "tcx"; fileSha256: string; bytes: number; staged: { workouts: ParsedWorkout[] } };

/**
 * Reads an uploaded file as a STREAM (never the whole file in memory for Apple Health), detects its format from content and
 * extracts only what the app can import. Throws IngestError for anything that is not a supported real export.
 */
export async function analyzeUpload(stream: ReadableStream<Uint8Array>): Promise<AnalyzedUpload> {
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  let bytes = 0;
  let format: "apple_health" | "gpx" | "tcx" | null = null;
  let head = "";
  let small = "";
  const apple = new AppleHealthScanner();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_IMPORT_BYTES) throw new IngestError("arquivo grande demais");
    hash.update(value);
    const text = decoder.decode(value, { stream: true });
    if (format === null) {
      head += text;
      format = detect(head);
      if (format === null) {
        if (head.length > SNIFF_LIMIT) throw new IngestError("formato não reconhecido: envie GPX, TCX ou o export.xml do Apple Health");
        continue;
      }
      if (format === "apple_health") { apple.push(head); } else { small = head; }
      continue;
    }
    if (format === "apple_health") apple.push(text); else { small += text; if (small.length > MAX_SMALL_FILE_BYTES) throw new IngestError("arquivo grande demais"); }
  }
  const tail = decoder.decode();
  if (format === null) {
    head += tail;
    format = detect(head);
    if (format === null) throw new IngestError("formato não reconhecido: envie GPX, TCX ou o export.xml do Apple Health");
    if (format === "apple_health") apple.push(head); else small = head;
  } else if (tail) { if (format === "apple_health") apple.push(tail); else small += tail; }

  const fileSha256 = hash.digest("hex");
  if (format === "apple_health") {
    apple.finish();
    return { format, fileSha256, bytes, inventory: apple.inventory(), staged: { records: apple.records, workouts: apple.workouts } };
  }
  const workouts = format === "gpx" ? [parseGpx(small)] : parseTcx(small);
  return { format, fileSha256, bytes, staged: { workouts } };
}
