import { z } from "zod";

/** V0 single hardcoded workspace per phase doc */
export const V0_WORKSPACE_ID = "v0-local" as const;

export const EvidenceRefSchema = z.object({
  bucket: z.string(),
  key: z.string(),
  sha256: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const FieldProvenanceSchema = z.object({
  field: z.string(),
  value: z.unknown(),
  sourceSnippet: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});
export type FieldProvenance = z.infer<typeof FieldProvenanceSchema>;

export const ParsedListingFieldsSchema = z.object({
  title: z.string().optional(),
  askingPrice: z.number().optional(),
  revenue: z.number().optional(),
  cashFlow: z.number().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  industry: z.string().optional(),
  brokerName: z.string().optional(),
  listingId: z.string().optional(),
});
export type ParsedListingFields = z.infer<typeof ParsedListingFieldsSchema>;

export const SourceRecordSchema = z.object({
  id: z.string(),
  adapter: z.string(),
  url: z.string(),
  externalId: z.string().optional(),
  canonicalDealId: z.string().nullable(),
  evidenceRef: EvidenceRefSchema,
  parsedFields: ParsedListingFieldsSchema,
  fieldProvenance: z.array(FieldProvenanceSchema).optional(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

export const CanonicalDealSchema = z.object({
  id: z.string(),
  sourceIds: z.array(z.string()),
  representativeSourceId: z.string(),
  mergedAt: z.string().optional(),
});
export type CanonicalDeal = z.infer<typeof CanonicalDealSchema>;

export const DomainProfileSchema = z.object({
  host: z.string(),
  needsBrowser: z.boolean(),
  httpConcurrency: z.number().optional(),
  lastUpdatedAt: z.string(),
});
export type DomainProfile = z.infer<typeof DomainProfileSchema>;

export const DedupKeySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), value: z.string() }),
  z.object({
    kind: z.literal("external"),
    adapter: z.string(),
    externalId: z.string(),
  }),
  z.object({
    kind: z.literal("broker-listing"),
    brokerKey: z.string(),
    externalId: z.string(),
  }),
]);
export type DedupKey = z.infer<typeof DedupKeySchema>;

export interface FetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

export interface RawResponse {
  status: number;
  body: string;
  finalUrl: string;
  headers: Record<string, string>;
  evidenceRef?: EvidenceRef;
}

export interface ListingRef {
  url: string;
  externalId?: string;
}

export interface PutMeta {
  adapter: string;
  contentType: string;
  sourceUrl: string;
}
