import { IngestError, type ParsedWorkout } from "./types";
import { allTagTexts, attr, modalityFromType, tagText, toIsoUtc, toNumber } from "./util";

/** TCX (Garmin Training Center XML): returns one workout per <Activity>. Values come from the laps exactly as reported. */
export function parseTcx(xml: string): ParsedWorkout[] {
  if (!/<TrainingCenterDatabase[\s>]/i.test(xml)) throw new IngestError("not a TCX file");
  const out: ParsedWorkout[] = [];
  for (const m of xml.matchAll(/<Activity\b([^>]*)>([\s\S]*?)<\/Activity>/gi)) {
    const sport = attr(m[1] ?? "", "Sport");
    const body = m[2] ?? "";
    const laps = [...body.matchAll(/<Lap\b([^>]*)>([\s\S]*?)<\/Lap>/gi)].map((l) => ({
      start: attr(l[1] ?? "", "StartTime"),
      seconds: toNumber(tagText(l[2] ?? "", "TotalTimeSeconds")),
      meters: toNumber(tagText(l[2] ?? "", "DistanceMeters")),
      calories: toNumber(tagText(l[2] ?? "", "Calories")),
      avgHr: toNumber(tagText(tagText(l[2] ?? "", "AverageHeartRateBpm") ?? "", "Value")),
      maxHr: toNumber(tagText(tagText(l[2] ?? "", "MaximumHeartRateBpm") ?? "", "Value")),
    }));
    const id = tagText(body, "Id");
    const startIso = toIsoUtc(laps.find((l) => l.start)?.start ?? id ?? "");
    if (!startIso) continue;
    const known = <K extends "seconds" | "meters" | "calories">(k: K) => laps.map((l) => l[k]).filter((v): v is number => v !== null);
    const sum = (v: number[]) => (v.length === laps.length && v.length > 0 ? v.reduce((s, x) => s + x, 0) : null);
    const hrLaps = laps.filter((l) => l.avgHr !== null && l.seconds !== null && l.seconds > 0);
    const totalHrSeconds = hrLaps.reduce((s, l) => s + (l.seconds as number), 0);
    const maxes = laps.map((l) => l.maxHr).filter((v): v is number => v !== null);
    out.push({
      format: "tcx",
      startedAt: startIso,
      durationSeconds: sum(known("seconds")),
      distanceMeters: sum(known("meters")),
      distanceDerived: false,
      avgHeartRateBpm: hrLaps.length === laps.length && totalHrSeconds > 0 ? Math.round(hrLaps.reduce((s, l) => s + (l.avgHr as number) * (l.seconds as number), 0) / totalHrSeconds) : null,
      maxHeartRateBpm: maxes.length > 0 ? Math.max(...maxes) : null,
      calories: sum(known("calories")),
      sourceActivityType: sport,
      modality: modalityFromType(sport),
      sourceName: allTagTexts(xml, "Name")[0] ?? null,
    });
  }
  if (out.length === 0) throw new IngestError("TCX has no activities");
  return out;
}
