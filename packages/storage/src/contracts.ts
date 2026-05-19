import type { Readable } from "node:stream";
import type {
  CanonicalDeal,
  DedupKey,
  DomainProfile,
  EvidenceRef,
  ProcessedArtifactKind,
  PutMeta,
  SourceRecord,
} from "@clearbolt/core";

export interface EvidenceMeta {
  sha256: string;
  contentType: string;
  sizeBytes: number;
  key: string;
  bucket: string;
}

/** Options for wiki writes (e.g. maintainer version / commit message). */
export interface WikiWriteOpts {
  message?: string;
}

export interface WikiReadResult {
  content: string;
  sha256: string;
}

export interface WikiStore {
  read(workspaceId: string, path: string): Promise<WikiReadResult | null>;
  write(
    workspaceId: string,
    path: string,
    content: string,
    opts?: WikiWriteOpts,
  ): Promise<{ sha256: string }>;
  list(
    workspaceId: string,
    prefix?: string,
  ): AsyncIterable<{ path: string; lastModified: Date }>;
  /** Optional content-addressed snapshot hook; disk/R2 backends implement as needed. */
  snapshot?(workspaceId: string, path: string, sha256: string): Promise<void>;
}

export interface EvidenceStore {
  put(payload: Uint8Array | Readable, meta: PutMeta): Promise<EvidenceRef>;
  get(ref: EvidenceRef): Promise<Readable>;
  exists(sha256: string, adapter?: string): Promise<boolean>;
  head(ref: EvidenceRef): Promise<EvidenceMeta>;
}

export interface ProcessedPutMeta {
  adapter: string;
  kind: ProcessedArtifactKind;
  contentType: string;
  sourceUrl: string;
  /** sha256 of the raw HTML/JSON evidence this row was derived from. */
  derivedFromSha256: string;
  parserVersion?: string;
}

/** Processed listing artifacts (markdown, structured JSON, vectors, classification) on object storage. */
export interface ProcessedArtifactStore {
  put(
    payload: Uint8Array | Readable,
    meta: ProcessedPutMeta,
  ): Promise<EvidenceRef>;
  get(ref: EvidenceRef): Promise<Readable>;
  exists(sha256: string, adapter?: string): Promise<boolean>;
  head(ref: EvidenceRef): Promise<EvidenceMeta>;
}

/** V0 subset of full MetadataStore */
export interface MetadataStore {
  putSource(record: SourceRecord): Promise<void>;
  getSource(id: string): Promise<SourceRecord | null>;
  listSourceIds(): Promise<string[]>;

  putCanonical(deal: CanonicalDeal): Promise<void>;
  getCanonical(id: string): Promise<CanonicalDeal | null>;
  listCanonicalIds(): Promise<string[]>;

  /** Map canonical dedup key → canonical deal id */
  getCanonicalIdForDedupKey(key: DedupKey): Promise<string | null>;
  setDedupMapping(key: DedupKey, canonicalId: string): Promise<void>;

  getDomainProfile(host: string): Promise<DomainProfile | null>;
  putDomainProfile(profile: DomainProfile): Promise<void>;
}
