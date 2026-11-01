import { describe, expect, it } from "vitest";
import { AppleHealthScanner, IngestError, batchFromAppleHealth, batchFromWorkouts, parseAppleDate, parseGpx, parseTcx, scanAppleHealth, workoutExternalId } from "./index";

// FIXTURES: small standards-compliant files written for these tests. They are NOT real watch data.
const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="TestWatchApp" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
 <metadata><time>2026-11-02T09:00:00Z</time></metadata>
 <trk><name>Morning</name><type>running</type><trkseg>
  <trkpt lat="-23.5500" lon="-46.6300"><time>2026-11-02T09:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  <trkpt lat="-23.5510" lon="-46.6300"><time>2026-11-02T09:05:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  <trkpt lat="-23.5520" lon="-46.6300"><time>2026-11-02T09:10:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>160</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
 </trkseg></trk></gpx>`;
const GPX_NO_HR_UNKNOWN_TYPE = `<gpx version="1.1" creator="x"><trk><type>yoga</type><trkseg>
  <trkpt lat="1" lon="1"><time>2026-11-02T09:00:00Z</time></trkpt><trkpt lat="1" lon="1"><time>2026-11-02T09:30:00Z</time></trkpt></trkseg></trk></gpx>`;
const TCX = `<?xml version="1.0"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenter/v2">
 <Activities><Activity Sport="Running"><Id>2026-11-02T10:00:00Z</Id>
  <Lap StartTime="2026-11-02T10:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>1500</DistanceMeters><Calories>100</Calories>
   <AverageHeartRateBpm><Value>130</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>150</Value></MaximumHeartRateBpm></Lap>
  <Lap StartTime="2026-11-02T10:10:00Z"><TotalTimeSeconds>1200</TotalTimeSeconds><DistanceMeters>3500</DistanceMeters><Calories>200</Calories>
   <AverageHeartRateBpm><Value>160</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>175</Value></MaximumHeartRateBpm></Lap>
 </Activity><Activity Sport="Other"><Id>2026-11-03T10:00:00Z</Id><Lap StartTime="2026-11-03T10:00:00Z"><TotalTimeSeconds>900</TotalTimeSeconds></Lap></Activity></Activities>
</TrainingCenterDatabase>`;
const APPLE = `<?xml version="1.0" encoding="UTF-8"?><HealthData locale="pt_BR">
 <ExportDate value="2026-11-05 08:00:00 -0300"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Zepp" unit="count/min" creationDate="2026-11-02 08:00:00 -0300" startDate="2026-11-02 00:00:00 -0300" endDate="2026-11-02 00:00:00 -0300" value="52"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="OtherApp" unit="count/min" startDate="2026-11-02 00:00:00 -0300" endDate="2026-11-02 00:00:00 -0300" value="60"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Zepp" unit="ms" startDate="2026-11-02 03:00:00 -0300" endDate="2026-11-02 03:01:00 -0300" value="40"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Zepp" unit="ms" startDate="2026-11-02 04:00:00 -0300" endDate="2026-11-02 04:01:00 -0300" value="50"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Zepp" unit="count/min" startDate="2026-11-02 05:00:00 -0300" endDate="2026-11-02 05:00:00 -0300" value="60"><MetadataEntry key="x" value="y"/></Record>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Zepp" startDate="2026-11-01 23:00:00 -0300" endDate="2026-11-02 03:00:00 -0300" value="HKCategoryValueSleepAnalysisAsleepCore"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Zepp" startDate="2026-11-02 02:30:00 -0300" endDate="2026-11-02 06:30:00 -0300" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Zepp" startDate="2026-11-01 22:30:00 -0300" endDate="2026-11-02 06:45:00 -0300" value="HKCategoryValueSleepAnalysisInBed"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Zepp" startDate="2026-11-02 14:00:00 -0300" endDate="2026-11-02 14:30:00 -0300" value="HKCategoryValueSleepAnalysisAsleepUnspecified"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="45" durationUnit="min" totalDistance="8" totalDistanceUnit="km" totalEnergyBurned="500" totalEnergyBurnedUnit="kcal" sourceName="Zepp" startDate="2026-11-03 18:00:00 -0300" endDate="2026-11-03 18:45:00 -0300">
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2026-11-03 18:00:00 -0300" endDate="2026-11-03 18:45:00 -0300" average="150" minimum="100" maximum="172" unit="count/min"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeYoga" duration="30" durationUnit="min" sourceName="Zepp" startDate="2026-11-04 07:00:00 -0300" endDate="2026-11-04 07:30:00 -0300"/>
</HealthData>`;

describe("GPX", () => {
  it("reads start, duration, derived distance and heart rate; says the distance is derived", () => {
    const w = parseGpx(GPX);
    expect(w).toMatchObject({ format: "gpx", startedAt: "2026-11-02T09:00:00Z", durationSeconds: 600, modality: "run", avgHeartRateBpm: 140, maxHeartRateBpm: 160, distanceDerived: true, sourceName: "TestWatchApp" });
    expect(w.distanceMeters).toBeGreaterThan(200);
    expect(w.distanceMeters).toBeLessThan(250); // 2 x ~111 m
  });
  it("keeps unknown values null and never guesses a modality", () => {
    const w = parseGpx(GPX_NO_HR_UNKNOWN_TYPE);
    expect(w.avgHeartRateBpm).toBeNull();
    expect(w.modality).toBeNull();
    expect(w.sourceActivityType).toBe("yoga");
  });
  it("rejects files that are not GPX or have no track", () => {
    expect(() => parseGpx("<html/>")).toThrow(IngestError);
    expect(() => parseGpx("<gpx><trk><trkseg></trkseg></trk></gpx>")).toThrow(/no track points/);
  });
});

describe("TCX", () => {
  it("sums laps and time-weights the average heart rate", () => {
    const [a, b] = parseTcx(TCX);
    expect(a).toMatchObject({ format: "tcx", startedAt: "2026-11-02T10:00:00Z", durationSeconds: 1800, distanceMeters: 5000, calories: 300, maxHeartRateBpm: 175, modality: "run", distanceDerived: false });
    expect(a?.avgHeartRateBpm).toBe(150); // (130*600 + 160*1200) / 1800
    expect(b).toMatchObject({ modality: null, distanceMeters: null, avgHeartRateBpm: null, calories: null });
  });
  it("rejects non-TCX", () => expect(() => parseTcx("<gpx/>")).toThrow(IngestError));
});

describe("conversion to records", () => {
  it("builds file_import workouts with stable external ids and routes unknown types to the user", () => {
    const batch = batchFromWorkouts([parseGpx(GPX), parseGpx(GPX_NO_HR_UNKNOWN_TYPE)]);
    expect(batch.workouts).toHaveLength(1);
    expect(batch.needsModality).toHaveLength(1);
    expect(batch.workouts[0]).toMatchObject({ source: "file_import", modality: "run", durationMinutes: 10, quality: "complete" });
    expect(batch.workouts[0]?.notes).toMatch(/distância calculada/);
    expect(workoutExternalId(parseGpx(GPX))).toBe(workoutExternalId(parseGpx(GPX)));            // idempotent re-import
    expect(batch.warnings[0]).toMatch(/tipo desconhecido/);
  });
});

describe("Apple Health export", () => {
  it("parses dates with their own offset", () => {
    expect(parseAppleDate("2026-11-02 07:15:00 -0300")).toEqual({ iso: "2026-11-02T10:15:00Z", localDate: "2026-11-02" });
    expect(parseAppleDate("garbage")).toBeNull();
  });

  it("inventories what each source wrote (answers 'what does the watch app really provide?')", () => {
    const inv = scanAppleHealth(APPLE).inventory();
    const zepp = inv.filter((r) => r.sourceName === "Zepp").map((r) => r.type);
    expect(zepp).toContain("HKQuantityTypeIdentifierRestingHeartRate");
    expect(zepp).toContain("Workout:HKWorkoutActivityTypeRunning");
    expect(inv.find((r) => r.sourceName === "OtherApp")?.count).toBe(1);
  });

  it("imports only the chosen source: sleep (overlaps merged, nap excluded), resting HR, HRV (median), workouts", () => {
    const scan = scanAppleHealth(APPLE);
    const batch = batchFromAppleHealth(scan, new Set(["Zepp"]));
    expect(batch.sleep).toHaveLength(1);                    // one record per local night: the longest period wins
    const night = batch.sleep[0];
    expect(night?.nightDate).toBe("2026-11-02");
    expect(night?.durationMinutes).toBe(450);               // 23:00-06:30 = 7.5 h; overlap counted once; InBed ignored
    expect(batch.warnings.some((w) => /cochilos/.test(w) && w.startsWith("2026-11-02"))).toBe(true); // the 14:00 nap is reported, not silently merged
    expect(batch.observations.filter((o) => o.metric === "resting_heart_rate").map((o) => o.value)).toEqual([52]); // OtherApp excluded
    expect(batch.observations.find((o) => o.metric === "heart_rate_variability")).toMatchObject({ value: 45, unit: "ms" });
    expect(batch.workouts).toHaveLength(1);
    expect(batch.workouts[0]).toMatchObject({ modality: "run", durationMinutes: 45, distanceMeters: 8000, avgHeartRateBpm: 150, maxHeartRateBpm: 172, source: "file_import" });
    expect(batch.needsModality.map((w) => w.sourceActivityType)).toEqual(["HKWorkoutActivityTypeYoga"]);
    for (const r of [...batch.sleep, ...batch.observations, ...batch.workouts]) expect(r.externalId).toBeTruthy();
  });

  it("lets the user resolve an unknown workout type explicitly", () => {
    const batch = batchFromAppleHealth(scanAppleHealth(APPLE), new Set(["Zepp"]), { HKWorkoutActivityTypeYoga: "recovery" });
    expect(batch.needsModality).toHaveLength(0);
    expect(batch.workouts.map((w) => w.modality).sort()).toEqual(["recovery", "run"]);
  });

  it("is chunk-safe: splitting the file anywhere yields exactly the same result (large exports are streamed)", () => {
    const whole = scanAppleHealth(APPLE);
    for (const size of [7, 50, 333, 1000]) {
      const s = new AppleHealthScanner();
      for (let i = 0; i < APPLE.length; i += size) s.push(APPLE.slice(i, i + size));
      s.finish();
      expect(s.records.length).toBe(whole.records.length);
      expect(s.workouts.map((w) => w.startedAt)).toEqual(whole.workouts.map((w) => w.startedAt));
      expect(s.inventory()).toEqual(whole.inventory());
    }
  });

  it("drops a truncated trailing element instead of guessing and rejects non-exports", () => {
    const s = new AppleHealthScanner();
    s.push(APPLE.slice(0, APPLE.indexOf("<Workout workoutActivityType=\"HKWorkoutActivityTypeYoga\"") + 40));
    s.finish();
    expect(s.workouts).toHaveLength(1);
    expect(() => scanAppleHealth("<xml/>")).toThrow(IngestError);
  });
});
