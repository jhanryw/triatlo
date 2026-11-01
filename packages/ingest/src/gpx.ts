import { IngestError, type ParsedWorkout } from "./types";
import { allTagTexts, attr, haversine, modalityFromType, tagText, toIsoUtc, toNumber } from "./util";

/** GPX 1.1 track (+ Garmin TrackPointExtension heart rate when present). One file = one workout. */
export function parseGpx(xml: string): ParsedWorkout {
  if (!/<gpx[\s>]/i.test(xml)) throw new IngestError("not a GPX file");
  const points = [...xml.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi)].map((m) => ({
    lat: toNumber(attr(m[1] ?? "", "lat")),
    lon: toNumber(attr(m[1] ?? "", "lon")),
    time: tagText(m[2] ?? "", "time"),
    hr: toNumber(tagText(m[2] ?? "", "hr")),
  }));
  if (points.length === 0) throw new IngestError("GPX has no track points");
  const times = points.map((p) => (p.time ? toIsoUtc(p.time) : null)).filter((t): t is string => t !== null).map((t) => Date.parse(t));
  const metaTime = tagText(xml.replace(/<trk[\s\S]*$/i, ""), "time");
  const start = times.length > 0 ? Math.min(...times) : metaTime ? Date.parse(metaTime) : NaN;
  if (Number.isNaN(start)) throw new IngestError("GPX has no usable timestamps");

  const durationSeconds = times.length >= 2 ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : null;
  let distance = 0;
  let segments = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a && b && a.lat !== null && a.lon !== null && b.lat !== null && b.lon !== null) { distance += haversine(a.lat, a.lon, b.lat, b.lon); segments++; }
  }
  const hrs = points.map((p) => p.hr).filter((v): v is number => v !== null && v > 0);
  const type = tagText(xml.replace(/<trkpt[\s\S]*$/i, ""), "type") ?? allTagTexts(xml, "type")[0] ?? null;
  return {
    format: "gpx",
    startedAt: new Date(start).toISOString().replace(".000Z", "Z"),
    durationSeconds,
    distanceMeters: segments > 0 ? Math.round(distance) : null,
    distanceDerived: segments > 0,
    avgHeartRateBpm: hrs.length > 0 ? Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length) : null,
    maxHeartRateBpm: hrs.length > 0 ? Math.max(...hrs) : null,
    calories: null,
    sourceActivityType: type,
    modality: modalityFromType(type),
    sourceName: attr(/<gpx\b[^>]*>/i.exec(xml)?.[0] ?? "", "creator"),
  };
}
