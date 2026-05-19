import {
  NeonMetadataStore,
  neonMetadataConfigFromEnv,
} from "@clearbolt/storage-neon";

export function createMetadataStore(): NeonMetadataStore | null {
  const cfg = neonMetadataConfigFromEnv();
  if (!cfg) return null;
  return new NeonMetadataStore(cfg);
}
