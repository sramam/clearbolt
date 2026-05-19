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
  ebitda: z.number().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  stateName: z.string().optional(),
  location: z.string().optional(),
  industry: z.string().optional(),
  brokerName: z.string().optional(),
  /** BizBuySell `/business-broker/…` profile URL when present on the listing page. */
  brokerProfileUrl: z.string().optional(),
  listingId: z.string().optional(),
  yearEstablished: z.number().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  categories: z.array(z.string()).optional(),
  /** Truncated description for metadata / search. */
  description: z.string().optional(),
});
export type ParsedListingFields = z.infer<typeof ParsedListingFieldsSchema>;

/** Processed derivatives of raw listing evidence (stored in R2 / disk, not inlined in Postgres). */
export const ProcessedArtifactKindSchema = z.enum([
  "markdown",
  "structured",
  "embedding",
  "classification",
]);
export type ProcessedArtifactKind = z.infer<typeof ProcessedArtifactKindSchema>;

/** Pointers to content-addressed processed blobs (same shape as raw evidence refs). */
export const ProcessedArtifactsSchema = z.object({
  markdown: EvidenceRefSchema.optional(),
  structured: EvidenceRefSchema.optional(),
  embedding: EvidenceRefSchema.optional(),
  classification: EvidenceRefSchema.optional(),
});
export type ProcessedArtifacts = z.infer<typeof ProcessedArtifactsSchema>;

export const SourceRecordSchema = z.object({
  id: z.string(),
  adapter: z.string(),
  url: z.string(),
  externalId: z.string().optional(),
  canonicalDealId: z.string().nullable(),
  evidenceRef: EvidenceRefSchema,
  /** Markdown, structured extraction, embeddings, AI classification — each on object storage. */
  processedArtifacts: ProcessedArtifactsSchema.optional(),
  parsedFields: ParsedListingFieldsSchema,
  fieldProvenance: z.array(FieldProvenanceSchema).optional(),
  /** sha256 of normalized visible HTML text — cheap re-scrape / same-URL update detection */
  bodyFingerprint: z.string().optional(),
  /** Optional embedding of listing body text (e.g. OpenRouter); V1+ may live in pgvector only */
  bodyEmbedding: z.array(z.number()).optional(),
  bodyEmbeddingModel: z.string().optional(),
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

/** Per-user dealbox vs anti-dealbox on a workspace project. */
export const DispositionBucketSchema = z.enum(["dealbox", "anti_dealbox"]);
export type DispositionBucket = z.infer<typeof DispositionBucketSchema>;

export const DispositionSourceSchema = z.enum(["user", "ai"]);
export type DispositionSource = z.infer<typeof DispositionSourceSchema>;

export const WorkspaceProjectStatusSchema = z.enum([
  "candidate",
  "researching",
  "diligence",
  "passed",
  "closed",
]);
export type WorkspaceProjectStatus = z.infer<
  typeof WorkspaceProjectStatusSchema
>;

export const WorkspaceProjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  createdByUserId: z.string(),
  title: z.string(),
  canonicalDealId: z.string().nullable(),
  status: WorkspaceProjectStatusSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkspaceProject = z.infer<typeof WorkspaceProjectSchema>;

export const UserMarketQuerySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  ownerUserId: z.string(),
  adapter: z.string(),
  searchUrl: z.string(),
  label: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserMarketQuery = z.infer<typeof UserMarketQuerySchema>;

export const UserProjectDispositionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  bucket: DispositionBucketSchema,
  source: DispositionSourceSchema,
  aiConfidence: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserProjectDisposition = z.infer<
  typeof UserProjectDispositionSchema
>;
