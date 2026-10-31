import { z } from "zod";
import { DATA_QUALITIES } from "./enums";
import { UtcDateTimeSchema } from "./common";

/**
 * Origin of a record. "external_connector" is reserved for an authorized connector that has been
 * technically proven (see docs/INTEGRATIONS.md); none exists yet. No Amazfit/Zepp integration is implemented.
 */
export const SOURCE_KINDS = ["manual", "file_import", "external_connector"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Normalised record produced by any data source. Missing fields stay null/absent — never defaulted to 0. */
export const NormalizedRecordSchema = z
  .object({
    sourceKind: z.enum(SOURCE_KINDS),
    /** Identifier of the connector/importer instance, e.g. "manual-form". */
    sourceId: z.string().min(1),
    /** Id in the origin system; with sourceId it makes imports idempotent. */
    externalId: z.string().min(1),
    recordedAt: UtcDateTimeSchema,
    receivedAt: UtcDateTimeSchema,
    kind: z.string().min(1),
    quality: z.enum(DATA_QUALITIES),
    values: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  })
  .strict();
export type NormalizedRecord = z.infer<typeof NormalizedRecordSchema>;

/** Contract every data source (manual import, file import, future connector) must implement. */
export interface DataSource {
  readonly kind: SourceKind;
  readonly id: string;
  /** Returns records newer than `since` (UTC). Must never fabricate data. */
  fetchSince(since: string | null): Promise<NormalizedRecord[]>;
}
