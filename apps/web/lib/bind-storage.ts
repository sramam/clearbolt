import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  R2ProcessedArtifactStore,
  r2EvidenceConfigFromEnv,
} from "@clearbolt/storage-r2";

const monorepoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export interface BoundStorage {
  evidence: EvidenceStore;
  processedArtifacts: ProcessedArtifactStore;
  metadata: MetadataStore;
  disconnect?: () => Promise<void>;
}

export async function bindStorageForScrape(): Promise<BoundStorage> {
  const root = process.env.DATA_DIR ?? join(monorepoRoot, "data");
  const r2Config = r2EvidenceConfigFromEnv();
  const neonConfig = neonMetadataConfigFromEnv();
  const wantCloud = process.env.CLEARBOLT_STORAGE === "cloud";
  const useR2 = wantCloud && r2Config !== null;
  const useNeon = wantCloud && neonConfig !== null;

  if (wantCloud && !r2Config) {
    throw new Error(
      "CLEARBOLT_STORAGE=cloud requires R2 evidence env (see .env.example)",
    );
  }
  if (wantCloud && !neonConfig) {
    throw new Error("CLEARBOLT_STORAGE=cloud requires DATABASE_URL");
  }

  const evidence: EvidenceStore = useR2
    ? new R2EvidenceStore(r2Config)
    : new DiskEvidenceStore(root);

  let disconnect: (() => Promise<void>) | undefined;
  const metadata: MetadataStore = useNeon
    ? (() => {
        const neon = new NeonMetadataStore(neonConfig);
        disconnect = () => neon.disconnect();
        return neon;
      })()
    : new DiskMetadataStore(root);

  return { evidence, processedArtifacts, metadata, disconnect };
}
