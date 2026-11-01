import { createHash } from "node:crypto";
import type { CompletedWorkoutInput } from "@triatlo/shared";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Namespace-agnostic first match of <tag>…</tag> inner text. */
export function tagText(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i").exec(xml);
  return m?.[1] === undefined ? null : m[1].trim();
}

export function allTagTexts(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "gi"))].map((m) => (m[1] ?? "").trim());
}

export function attr(tagSource: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tagSource);
  return m?.[1] ?? null;
}

export const toNumber = (v: string | null): number | null => {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function toIsoUtc(value: string): string | null {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString().replace(".000Z", "Z");
}

/** Great-circle distance in meters (haversine). */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Activity-type -> our modality. Deliberately small and explicit. Anything not listed returns null so the user chooses;
 * cycling maps to indoor cycling only because the app plans indoor cycling (the file cannot say indoor/outdoor).
 */
const MODALITY_BY_TYPE: ReadonlyArray<[RegExp, CompletedWorkoutInput["modality"]]> = [
  [/^(running|run|treadmill|indoor_running|hkworkoutactivitytyperunning)$/i, "run"],
  [/^(swimming|swim|pool_swim|hkworkoutactivitytypeswimming)$/i, "swim"],
  [/^(biking|cycling|indoor_cycling|spinning|hkworkoutactivitytypecycling)$/i, "bike_indoor"],
  [/^(functionalstrengthtraining|traditionalstrengthtraining|strength|hkworkoutactivitytypefunctionalstrengthtraining|hkworkoutactivitytypetraditionalstrengthtraining)$/i, "strength"],
];
export function modalityFromType(type: string | null): CompletedWorkoutInput["modality"] | null {
  if (type === null) return null;
  const normalized = type.trim().replace(/\s+/g, "_");
  for (const [re, modality] of MODALITY_BY_TYPE) if (re.test(normalized)) return modality;
  return null;
}
