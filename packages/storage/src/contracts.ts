import type { Readable } from "node:stream";
import type {
  CanonicalDeal,
  DedupKey,
  DomainProfile,
  EvidenceRef,
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

export interface EvidenceStore {
  put(payload: Uint8Array | Readable, meta: PutMeta): Promise<EvidenceRef>;
  get(ref: EvidenceRef): Promise<Readable>;
  exists(sha256: string): Promise<boolean>;
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
