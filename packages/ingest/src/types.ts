import type { CompletedWorkoutInput, PhysiologicalObservationInput, SleepObservationInput } from "@triatlo/shared";

/** A workout read from a file. Unknown values are null; nothing is defaulted. */
export interface ParsedWorkout {
  format: "gpx" | "tcx" | "apple_health";
  /** ISO UTC. */
  startedAt: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
  /** True when the distance was computed from track points rather than reported by the source. */
  distanceDerived: boolean;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  calories: number | null;
  /** Activity type exactly as written in the file (e.g. "Running", "HKWorkoutActivityTypeSwimming"). */
  sourceActivityType: string | null;
  /** Our modality, or null when the type is unknown/ambiguous: the user must choose (never guessed). */
  modality: CompletedWorkoutInput["modality"] | null;
  /** Name of the app/device that produced it, when the file says so. */
  sourceName: string | null;
}

export interface ImportBatch {
  /** Everything that could be turned into records. */
  workouts: CompletedWorkoutInput[];
  sleep: SleepObservationInput[];
  observations: PhysiologicalObservationInput[];
  /** Workouts whose activity type could not be mapped: they need a modality chosen by the user. */
  needsModality: ParsedWorkout[];
  /** Human-readable notes about what was skipped or derived. */
  warnings: string[];
}

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}
