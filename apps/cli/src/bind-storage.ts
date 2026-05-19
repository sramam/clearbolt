import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DiskListingIngestStateStore,
  JsonBackendListingIngestStateStore,
  type ListingIngestStateStore,
  compositeListingIngestStateStore,
} from "@clearbolt/scraper";
import type {
  EvidenceStore,
  MetadataStore,
  ProcessedArtifactStore,
} from "@clearbolt/storage";
import {
  DiskEvidenceStore,
  DiskMetadataStore,
  DiskProcessedArtifactStore,
} from "@clearbolt/storage";
import {
  NeonMetadataStore,
  neonMetadataConfigFromEnv,
} from "@clearbolt/storage-neon";
import {
  R2EvidenceStore,
  R2ListingIngestStateStore,
  R2ProcessedArtifactStore,
  r2EvidenceConfigFromEnv,
} from "@clearbolt/storage-r2";
import dotenv from "dotenv";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export function loadRepoEnv(): void {
  dotenv.config({ path: join(repoRoot, ".env.cloud.local") });
  dotenv.config({ path: join(repoRoot, ".env.dev") });
  dotenv.config({ path: join(repoRoot, ".env") });
}

export interface BoundStorage {
  evidence: EvidenceStore;
  processedArtifacts: ProcessedArtifactStore;
  metadata: MetadataStore;
  /** Per-listing ingest status + failure traces (disk; mirrored to R2 when cloud). */
  listingIngestState: ListingIngestStateStore;
  /** Set when Neon is used; call after CLI commands if needed. */
  disconnect?: () => Promise<void>;
  evidenceBackend: "disk" | "r2";
  metadataBackend: "disk" | "neon";
  listingIngestStateBackend: "disk" | "disk+r2";
}

export function dataRoot(): string {
  return process.env.DATA_DIR ?? join(process.cwd(), "data");
}

export async function bindStorage(): Promise<BoundStorage> {
  loadRepoEnv();
  const root = dataRoot();

  const r2Config = r2EvidenceConfigFromEnv();
  const neonConfig = neonMetadataConfigFromEnv();

  const wantCloud = process.env.CLEARBOLT_STORAGE === "cloud";
  const useR2 = wantCloud && r2Config !== null;
  const useNeon = wantCloud && neonConfig !== null;

  if (wantCloud && !r2Config) {
    throw new Error(
      "CLEARBOLT_STORAGE=cloud requires R2_EVIDENCE_BUCKET, CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
    );
  }
  if (wantCloud && !neonConfig) {
    throw new Error("CLEARBOLT_STORAGE=cloud requires DATABASE_URL");
  }

  const evidence: EvidenceStore = useR2
    ? new R2EvidenceStore(r2Config)
    : new DiskEvidenceStore(root);

  const processedArtifacts: ProcessedArtifactStore = useR2
    ? new R2ProcessedArtifactStore(r2Config)
    : new DiskProcessedArtifactStore(root);

  let disconnect: (() => Promise<void>) | undefined;
  const metadata: MetadataStore = useNeon
    ? (() => {
        const neon = new NeonMetadataStore(neonConfig);
        disconnect = () => neon.disconnect();
        return neon;
      })()
    : new DiskMetadataStore(root);

  const listingStateStores: ListingIngestStateStore[] = [
    new DiskListingIngestStateStore(root),
  ];
  let listingIngestStateBackend: "disk" | "disk+r2" = "disk";
  if (useR2 && r2Config) {
    const r2Listing = new R2ListingIngestStateStore(r2Config);
    listingStateStores.push(
      new JsonBackendListingIngestStateStore({
        getJson: (adapter, externalId) =>
          r2Listing.getJson(adapter, externalId),
        putJson: (adapter, externalId, body) =>
          r2Listing.putJson(adapter, externalId, body),
      }),
    );
    listingIngestStateBackend = "disk+r2";
  }

  return {
    evidence,
    processedArtifacts,
    metadata,
    listingIngestState: compositeListingIngestStateStore(...listingStateStores),
    disconnect,
    evidenceBackend: useR2 ? "r2" : "disk",
    metadataBackend: useNeon ? "neon" : "disk",
    listingIngestStateBackend,
  };
}
