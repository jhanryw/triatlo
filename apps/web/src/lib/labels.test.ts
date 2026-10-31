import { DATA_QUALITIES, MODALITIES, SESSION_STATUSES } from "@triatlo/shared";
import { describe, expect, it } from "vitest";
import { DATA_QUALITY_LABELS, MODALITY_LABELS, SESSION_STATUS_LABELS } from "./labels";

describe("pt-BR labels", () => {
  it("cover every shared vocabulary value", () => {
    for (const value of MODALITIES) expect(MODALITY_LABELS[value]).toBeTruthy();
    for (const value of SESSION_STATUSES) expect(SESSION_STATUS_LABELS[value].label).toBeTruthy();
    for (const value of DATA_QUALITIES) expect(DATA_QUALITY_LABELS[value]).toBeTruthy();
    expect(Object.keys(MODALITY_LABELS)).toHaveLength(MODALITIES.length);
  });

  it("does not describe cancelled sessions as a failure", () => {
    expect(SESSION_STATUS_LABELS.cancelled.description).toMatch(/sem penalidade/i);
  });
});
