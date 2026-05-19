import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { listingRefDedupeKey } from "./discovery/listing-ref-merge.js";
import {
  isSatisfiedListingStatus,
  type ListingIngestState,
  type ListingIngestStateStore,
} from "./listing-ingest-state.js";
import {
  listingIndexPath,
  listingRunManifestPath,
  readListingIndex,
  scrapeBaseDir,
  writeListingIndex,
  writeListingRunManifest,
  type ListingIndex,
} from "./scrape-paths.js";
import type { ScrapeRunContext } from "./scrape-run-context.js";

function indexToLegacyState(index: ListingIndex): ListingIngestState {
  return {
    version: 1,
    at: index.updatedAt,
    adapter: index.adapter,
    externalId: index.listingId,
    url: index.url,
    status: index.status,
    canonicalId: index.canonicalId,
    sourceRecordId: index.sourceRecordId,
  };
}

/** Writes listing indexes under `scrapes/listings/…` (ADR 0017). */
export class ScrapeRunListingStateStore implements ListingIngestStateStore {
  constructor(private readonly ctx: ScrapeRunContext) {}

  async get(adapter: string, externalId: string): Promise<ListingIngestState | null> {
    const index = await readListingIndex(
      listingIndexPath(
        this.ctx.dataRoot,
        this.ctx.lane,
        this.ctx.domain,
        this.ctx.scrapeId,
        externalId,
      ),
    );
    if (!index || index.adapter !== adapter) return null;
    return indexToLegacyState(index);
  }

  async put(state: ListingIngestState): Promise<void> {
    const at = state.at ?? new Date().toISOString();
    const listingId = state.externalId;
    const priorIndex = await readListingIndex(
      listingIndexPath(
        this.ctx.dataRoot,
        this.ctx.lane,
        this.ctx.domain,
        this.ctx.scrapeId,
        listingId,
      ),
    );
    const lastSuccessRunId =
      state.status === "ingested"
        ? this.ctx.runId
        : priorIndex?.lastSuccessRunId;

    const index: ListingIndex = {
      version: 1,
      listingId,
      adapter: state.adapter,
      url: state.url,
      status: state.status,
      lastAttemptRunId: this.ctx.runId,
      lastSuccessRunId:
        state.status === "ingested" ? this.ctx.runId : lastSuccessRunId,
      canonicalId: state.canonicalId,
      sourceRecordId: state.sourceRecordId,
      updatedAt: at,
    };
    await writeListingIndex(
      listingIndexPath(
        this.ctx.dataRoot,
        this.ctx.lane,
        this.ctx.domain,
        this.ctx.scrapeId,
        listingId,
      ),
      index,
    );

    if (state.evidenceRef || state.processedArtifactKeys?.length) {
      await writeListingRunManifest(
        listingRunManifestPath(
          this.ctx.dataRoot,
          this.ctx.lane,
          this.ctx.domain,
          this.ctx.scrapeId,
          listingId,
          this.ctx.runId,
        ),
        {
          version: 1,
          listingId,
          runId: this.ctx.runId,
          at,
          evidenceRef: state.evidenceRef,
          processedArtifactKeys: state.processedArtifactKeys,
        },
      );
    }
  }

  async listIngestedDedupeKeys(adapter: string): Promise<Set<string>> {
    const keys = new Set<string>();
    const listingsDir = join(
      scrapeBaseDir(
        this.ctx.dataRoot,
        this.ctx.lane,
        this.ctx.domain,
        this.ctx.scrapeId,
      ),
      "listings",
    );
    let entries: string[];
    try {
      entries = await readdir(listingsDir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return keys;
      throw err;
    }
    for (const entry of entries) {
      const index = await readListingIndex(join(listingsDir, entry, "index.json"));
      if (
        index &&
        index.adapter === adapter &&
        isSatisfiedListingStatus(index.status)
      ) {
        keys.add(listingRefDedupeKey({ url: index.url, externalId: index.listingId }));
      }
    }
    return keys;
  }
}
