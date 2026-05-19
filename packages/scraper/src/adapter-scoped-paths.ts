import { join } from "node:path";
import type { PutMeta } from "@clearbolt/core";

/** Sanitize adapter id for filesystem paths. */
export function normalizeAdapterId(adapter: string): string {
  return adapter.replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown";
}

export function ingestFailuresPath(
  dataRootDir: string,
  adapter: string,
): string {
  return join(dataRootDir, "ingest-failures", `${normalizeAdapterId(adapter)}.json`);
}

export function listingIngestStateDir(
  dataRootDir: string,
  adapter: string,
): string {
  return join(dataRootDir, "listing-ingest-state", normalizeAdapterId(adapter));
}

export function catalogRefsPath(
  dataRootDir: string,
  adapter: string,
  catalogPathSlug: string,
): string {
  return join(
    dataRootDir,
    "catalog-refs",
    normalizeAdapterId(adapter),
    `${catalogPathSlug}.json`,
  );
}

export function brokerRefsPath(
  dataRootDir: string,
  adapter: string,
  directoryPathSlug: string,
): string {
  return join(
    dataRootDir,
    "broker-refs",
    normalizeAdapterId(adapter),
    `${directoryPathSlug}.json`,
  );
}

/** Evidence / processed keys must stay under the adapter segment. */
export function assertAdapterScopedPutMeta(meta: PutMeta): void {
  const adapter = normalizeAdapterId(meta.adapter);
  if (!adapter || adapter === "unknown") {
    throw new Error("EvidenceStore.put requires a known meta.adapter");
  }
}

export function assertEvidenceRefMatchesAdapter(
  ref: { key: string },
  adapter: string,
): void {
  const safe = normalizeAdapterId(adapter);
  const segments = ref.key.split("/").filter(Boolean);
  if (segments[0] === "raw" || segments[0] === "shared") {
    if (segments[1] !== safe) {
      throw new Error(
        `Evidence ref key ${ref.key} does not match adapter ${adapter}`,
      );
    }
    return;
  }
  if (segments[0] === "processed" && segments[1] !== safe) {
    throw new Error(
      `Processed ref key ${ref.key} does not match adapter ${adapter}`,
    );
  }
}
