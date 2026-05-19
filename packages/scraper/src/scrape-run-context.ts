import { access, copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ListingRef } from "@clearbolt/core";
import { catalogAdapterFromUrl } from "./catalog-adapter-from-url.js";
import type { CatalogIngestOverallCounts, CatalogScrapeRunResult } from "./run-catalog-scrape.js";
import {
  allocateNextRunId,
  createInitialScrapeMeta,
  cumulativeFromListingIndexes,
  domainFromUrl,
  readListingIndex,
  readScrapeMeta,
  scrapeBaseDir,
  scrapeIdFromUrl,
  scrapeMetaPath,
  scrapeRunDiscoveryRefsPath,
  scrapeRunPath,
  writeScrapeMeta,
  writeScrapeRun,
  type ListingIndex,
  type ScrapeLane,
  type ScrapeRun,
} from "./scrape-paths.js";

export type ScrapeRunContext = {
  dataRoot: string;
  lane: ScrapeLane;
  domain: string;
  scrapeId: string;
  adapter: string;
  catalogUrl: string;
  runId: number;
  runKind: string;
  runStartedAt: string;
};

export function listingScrapeContextFromCatalogUrl(
  dataRoot: string,
  catalogUrl: string,
): Omit<ScrapeRunContext, "runId" | "runKind" | "runStartedAt"> {
  const adapter = catalogAdapterFromUrl(catalogUrl);
  const domain = domainFromUrl(catalogUrl);
  const scrapeId = scrapeIdFromUrl(catalogUrl);
  return {
    dataRoot,
    lane: "listings",
    domain,
    scrapeId,
    adapter,
    catalogUrl,
  };
}

export async function beginListingScrapeRun(input: {
  dataRoot: string;
  catalogUrl: string;
  runKind: string;
  discovered?: number;
}): Promise<ScrapeRunContext> {
  const base = listingScrapeContextFromCatalogUrl(input.dataRoot, input.catalogUrl);
  const metaPath = scrapeMetaPath(
    base.dataRoot,
    base.lane,
    base.domain,
    base.scrapeId,
  );
  const existing = await readScrapeMeta(metaPath);
  if (!existing) {
    await writeScrapeMeta(
      metaPath,
      createInitialScrapeMeta({
        lane: base.lane,
        scrapeId: base.scrapeId,
        domain: base.domain,
        adapter: base.adapter,
        catalogUrl: base.catalogUrl,
        discovered: input.discovered ?? 0,
      }),
    );
  }
  const runId = await allocateNextRunId(metaPath);
  const startedAt = new Date().toISOString();
  const run: ScrapeRun = {
    version: 1,
    runId,
    status: "running",
    kind: input.runKind,
    startedAt,
  };
  await writeScrapeRun(
    scrapeRunPath(base.dataRoot, base.lane, base.domain, base.scrapeId, runId),
    run,
  );
  return { ...base, runId, runKind: input.runKind, runStartedAt: startedAt };
}

export async function countListingIndexesOnScrape(
  dataRoot: string,
  lane: ScrapeLane,
  domain: string,
  scrapeId: string,
): Promise<{
  ingested: number;
  failed: number;
  skipped_known: number;
  skipped_fresh: number;
  total: number;
}> {
  const counts = {
    ingested: 0,
    failed: 0,
    skipped_known: 0,
    skipped_fresh: 0,
    total: 0,
  };
  const listingsDir = join(scrapeBaseDir(dataRoot, lane, domain, scrapeId), "listings");
  let entries: string[];
  try {
    entries = await readdir(listingsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return counts;
    throw err;
  }
  for (const entry of entries) {
    const index = await readListingIndex(join(listingsDir, entry, "index.json"));
    if (!index) continue;
    counts.total++;
    if (index.status === "ingested") counts.ingested++;
    else if (index.status === "failed") counts.failed++;
    else if (index.status === "skipped_known") counts.skipped_known++;
    else if (index.status === "skipped_fresh") counts.skipped_fresh++;
  }
  return counts;
}

export async function listFailedListingRefsFromScrape(
  dataRoot: string,
  catalogUrl: string,
): Promise<ListingRef[]> {
  const { lane, domain, scrapeId } = listingScrapeContextFromCatalogUrl(
    dataRoot,
    catalogUrl,
  );
  const listingsDir = join(scrapeBaseDir(dataRoot, lane, domain, scrapeId), "listings");
  const refs: ListingRef[] = [];
  let entries: string[];
  try {
    entries = await readdir(listingsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return refs;
    throw err;
  }
  for (const entry of entries) {
    const index = await readListingIndex(join(listingsDir, entry, "index.json"));
    if (!index || index.status !== "failed") continue;
    refs.push({ url: index.url, externalId: index.listingId });
  }
  return refs;
}

export async function completeListingScrapeRun(
  ctx: ScrapeRunContext,
  result: Pick<
    CatalogScrapeRunResult,
    | "listingsDiscovered"
    | "listingsIngested"
    | "listingsFailed"
    | "listingsSkippedKnown"
    | "listingsSkippedFresh"
  >,
  options?: { catalogRefsPath?: string },
): Promise<CatalogIngestOverallCounts> {
  const finishedAt = new Date().toISOString();
  const indexes = await loadAllListingIndexes(ctx);
  const discovered =
    result.listingsDiscovered > 0
      ? result.listingsDiscovered
      : (await readScrapeMeta(
          scrapeMetaPath(ctx.dataRoot, ctx.lane, ctx.domain, ctx.scrapeId),
        ))?.cumulative.discovered ?? indexes.length;

  const cumulative = cumulativeFromListingIndexes(
    indexes,
    discovered,
    finishedAt,
    ctx.runId,
  );

  const runStatus =
    result.listingsFailed > 0 && result.listingsIngested === 0
      ? "failed"
      : result.listingsFailed > 0
        ? "partial"
        : "completed";

  await writeScrapeRun(
    scrapeRunPath(ctx.dataRoot, ctx.lane, ctx.domain, ctx.scrapeId, ctx.runId),
    {
      version: 1,
      runId: ctx.runId,
      status: runStatus,
      kind: ctx.runKind,
      startedAt: ctx.runStartedAt,
      finishedAt,
      thisRun: {
        discovered: result.listingsDiscovered,
        ingested: result.listingsIngested,
        failed: result.listingsFailed,
        skippedKnown: result.listingsSkippedKnown,
        skippedFresh: result.listingsSkippedFresh,
      },
    },
  );

  const metaPath = scrapeMetaPath(
    ctx.dataRoot,
    ctx.lane,
    ctx.domain,
    ctx.scrapeId,
  );
  const meta = await readScrapeMeta(metaPath);
  if (meta) {
    await writeScrapeMeta(metaPath, {
      ...meta,
      latestRunId: ctx.runId,
      cumulative,
    });
  }

  if (options?.catalogRefsPath) {
    const dest = scrapeRunDiscoveryRefsPath(
      ctx.dataRoot,
      ctx.lane,
      ctx.domain,
      ctx.scrapeId,
      ctx.runId,
    );
    await mkdir(join(dest, ".."), { recursive: true });
    try {
      await access(options.catalogRefsPath);
      await copyFile(options.catalogRefsPath, dest);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }

  return {
    ingested: cumulative.ingested,
    failed: cumulative.failed,
    skippedKnown: cumulative.skippedKnown,
    skippedFresh: cumulative.skippedFresh,
    satisfied: cumulative.satisfied,
  };
}

async function loadAllListingIndexes(ctx: ScrapeRunContext): Promise<ListingIndex[]> {
  const listingsDir = join(
    scrapeBaseDir(ctx.dataRoot, ctx.lane, ctx.domain, ctx.scrapeId),
    "listings",
  );
  const out: ListingIndex[] = [];
  let entries: string[];
  try {
    entries = await readdir(listingsDir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const index = await readListingIndex(join(listingsDir, entry, "index.json"));
    if (index) out.push(index);
  }
  return out;
}

/** Failed refs: new scrape layout when `scrape.json` exists, else legacy disk. */
export async function listFailedListingRefsForCatalog(
  dataRoot: string,
  catalogUrl: string,
  adapter: string,
): Promise<ListingRef[]> {
  const { lane, domain, scrapeId } = listingScrapeContextFromCatalogUrl(
    dataRoot,
    catalogUrl,
  );
  const meta = await readScrapeMeta(
    scrapeMetaPath(dataRoot, lane, domain, scrapeId),
  );
  if (meta) {
    return listFailedListingRefsFromScrape(dataRoot, catalogUrl);
  }
  const { listFailedListingRefsFromDisk } = await import(
    "./ingest-failure-collection.js"
  );
  return listFailedListingRefsFromDisk(dataRoot, adapter);
}
