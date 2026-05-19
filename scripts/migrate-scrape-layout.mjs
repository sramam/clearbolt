#!/usr/bin/env node
/**
 * Transform legacy data1 layout → scrape-run tree under data/ (ADR 0017).
 *
 * Produces ONLY the new tree under DATA_DIR (default `data/`):
 *   scrapes/listings/<domain>/<scrape-id>/
 *     scrape.json, runs/1/, listings/<id>/runs/1/{listing.html,structured.json,...}
 *     corpus/{sources,deals,index,ingest-failures}.json
 *
 * Does NOT create data/raw, data/processed, or data/listing-ingest-state at repo root.
 *
 * Prerequisites:
 *   mv data data1 && mkdir data
 *
 * Usage:
 *   DATA_DIR_SOURCE=data1 DATA_DIR=data pnpm migrate:scrape-layout
 *   … --check              # counts + missing-file audit, no writes
 *   … --skip-materialize   # layout + indexes only (no HTML copy)
 *   … --skip-corpus        # skip sources/deals/dedup copy into corpus/
 */
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.env.DATA_DIR_SOURCE ?? join(repoRoot, "data1");
const targetRoot = process.env.DATA_DIR ?? join(repoRoot, "data");
const checkOnly = process.argv.includes("--check");
const skipMaterialize = process.argv.includes("--skip-materialize");
const skipCorpus = process.argv.includes("--skip-corpus");

const CATALOG_URL =
  process.env.MIGRATE_CATALOG_URL ??
  "https://www.bizbuysell.com/california-businesses-for-sale/";
const ADAPTER = "bizbuysell";
const LANE = "listings";
const RUN_ID = 1;
const RUN_KIND = "legacy-import";

const ARTIFACT_NAMES = {
  markdown: "listing.md",
  structured: "structured.json",
  classification: "classification.json",
  embedding: "embedding.json",
};

function domainFromUrl(url) {
  const host = new URL(url).hostname.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

function scrapeIdFromUrl(url) {
  const slug = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  return slug || "catalog";
}

function scrapeBase(dataRoot, domain, scrapeId) {
  return join(dataRoot, "scrapes", LANE, domain, scrapeId);
}

function legacyStateDir(dataRoot) {
  return join(dataRoot, "listing-ingest-state", ADAPTER);
}

function safeListingDirName(listingId) {
  return listingId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function listingRunDir(base, listingId, runId = RUN_ID) {
  return join(
    base,
    "listings",
    safeListingDirName(listingId),
    "runs",
    String(runId),
  );
}

function dataRel(absPath) {
  return relative(targetRoot, absPath).split("\\").join("/");
}

async function findCatalogRefs(source) {
  const candidates = [
    join(source, "catalog-refs", "california-businesses-for-sale.json"),
    join(
      source,
      "catalog-refs",
      ADAPTER,
      "california-businesses-for-sale.json",
    ),
  ];
  for (const p of candidates) {
    try {
      await readFile(p, "utf8");
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function loadLegacyStates(source) {
  const base = legacyStateDir(source);
  const entries = await readdir(base);
  const states = [];
  for (const entry of entries) {
    const path = join(base, entry, "state.json");
    try {
      const raw = await readFile(path, "utf8");
      const state = JSON.parse(raw);
      if (state?.externalId) states.push(state);
    } catch {
      /* skip */
    }
  }
  return states;
}

function toListingIndex(state, at) {
  const status = state.status ?? "failed";
  const runId = RUN_ID;
  return {
    version: 1,
    listingId: state.externalId,
    adapter: state.adapter ?? ADAPTER,
    url: state.url,
    status,
    lastAttemptRunId: runId,
    lastSuccessRunId: status === "ingested" ? runId : undefined,
    canonicalId: state.canonicalId,
    sourceRecordId: state.sourceRecordId,
    updatedAt: state.at ?? at,
  };
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(src, dest) {
  if (!(await pathExists(src))) return false;
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  return true;
}

function mapProcessedKeyToLocalName(processedKey) {
  const parts = processedKey.split("/").filter(Boolean);
  const kind = parts[2];
  return ARTIFACT_NAMES[kind] ?? parts[parts.length - 1];
}

async function materializeListingRun(sourceRoot, runDir, state) {
  const stats = { copied: 0, missing: 0 };
  const localArtifacts = [];

  if (state.evidenceRef?.key) {
    const src = join(sourceRoot, state.evidenceRef.key);
    const destName = "listing.html";
    const dest = join(runDir, destName);
    if (await copyIfExists(src, dest)) {
      stats.copied++;
      localArtifacts.push(destName);
    } else {
      stats.missing++;
    }
  }

  for (const processedKey of state.processedArtifactKeys ?? []) {
    const src = join(sourceRoot, processedKey);
    const destName = mapProcessedKeyToLocalName(processedKey);
    const dest = join(runDir, destName);
    if (await copyIfExists(src, dest)) {
      stats.copied++;
      localArtifacts.push(destName);
    } else {
      stats.missing++;
    }
  }

  return { stats, localArtifacts };
}

function buildManifest(state, at, runDir, localArtifacts) {
  const listingId = state.externalId;
  const hasListingHtml = localArtifacts.includes("listing.html");

  const evidenceRef =
    hasListingHtml && state.evidenceRef
      ? {
          bucket: state.evidenceRef.bucket ?? "disk",
          key: dataRel(join(runDir, "listing.html")),
          sha256: state.evidenceRef.sha256,
          contentType: state.evidenceRef.contentType ?? "text/html",
          sizeBytes: state.evidenceRef.sizeBytes ?? 0,
        }
      : state.evidenceRef;

  const processedArtifactKeys =
    localArtifacts.length > 0
      ? localArtifacts.filter((n) => n !== "listing.html")
      : state.processedArtifactKeys;

  const manifest = {
    version: 1,
    listingId,
    runId: RUN_ID,
    at: state.at ?? at,
    evidenceRef,
    processedArtifactKeys,
  };

  if (!hasListingHtml && state.evidenceRef?.key) {
    manifest.evidenceDataRoot = sourceRoot;
  }

  return manifest;
}

function tally(indexes) {
  const counts = {
    ingested: 0,
    failed: 0,
    skipped_known: 0,
    skipped_fresh: 0,
  };
  for (const row of indexes) {
    if (row.status === "ingested") counts.ingested++;
    else if (row.status === "failed") counts.failed++;
    else if (row.status === "skipped_known") counts.skipped_known++;
    else if (row.status === "skipped_fresh") counts.skipped_fresh++;
  }
  counts.satisfied =
    counts.ingested + counts.skipped_known + counts.skipped_fresh;
  return counts;
}

async function copyCorpus(source, base) {
  const corpusDir = join(base, "corpus");
  await mkdir(corpusDir, { recursive: true });
  const copied = { sources: 0, deals: 0, dedup: false, ingestFailures: false };

  const sourcesSrc = join(source, "sources");
  const sourcesDest = join(corpusDir, "sources");
  if (await pathExists(sourcesSrc)) {
    await mkdir(sourcesDest, { recursive: true });
    for (const name of await readdir(sourcesSrc)) {
      if (!name.endsWith(".json")) continue;
      await copyFile(join(sourcesSrc, name), join(sourcesDest, name));
      copied.sources++;
    }
  }

  const dealsSrc = join(source, "deals");
  const dealsDest = join(corpusDir, "deals");
  if (await pathExists(dealsSrc)) {
    await mkdir(dealsDest, { recursive: true });
    for (const name of await readdir(dealsSrc)) {
      if (!name.endsWith(".json")) continue;
      await copyFile(join(dealsSrc, name), join(dealsDest, name));
      copied.deals++;
    }
  }

  for (const dedupPath of [
    join(source, "index", ADAPTER, "dedup.json"),
    join(source, "index", "dedup.json"),
  ]) {
    if (await pathExists(dedupPath)) {
      const indexDir = join(corpusDir, "index", ADAPTER);
      await mkdir(indexDir, { recursive: true });
      await copyFile(dedupPath, join(indexDir, "dedup.json"));
      copied.dedup = true;
      break;
    }
  }

  for (const failPath of [
    join(source, "ingest-failures", `${ADAPTER}.json`),
    join(source, "ingest-failures.json"),
  ]) {
    if (await pathExists(failPath)) {
      await copyFile(failPath, join(corpusDir, "ingest-failures.json"));
      copied.ingestFailures = true;
      break;
    }
  }

  return copied;
}

async function main() {
  const domain = domainFromUrl(CATALOG_URL);
  const scrapeId = scrapeIdFromUrl(CATALOG_URL);
  const at = new Date().toISOString();
  const base = scrapeBase(targetRoot, domain, scrapeId);

  const states = await loadLegacyStates(sourceRoot);
  if (states.length === 0) {
    console.error(`No legacy states under ${legacyStateDir(sourceRoot)}`);
    process.exit(1);
  }

  const indexes = states.map((s) => toListingIndex(s, at));
  const counts = tally(indexes);

  let discovered = states.length;
  const refsPath = await findCatalogRefs(sourceRoot);
  if (refsPath) {
    const refsFile = JSON.parse(await readFile(refsPath, "utf8"));
    discovered = refsFile.refs?.length ?? discovered;
  }

  const materializeAudit = {
    listingsWithEvidence: 0,
    filesCopied: 0,
    filesMissing: 0,
  };

  if (!skipMaterialize) {
    for (const state of states) {
      if (!state.evidenceRef?.key && !state.processedArtifactKeys?.length) {
        continue;
      }
      materializeAudit.listingsWithEvidence++;
      const runDir = listingRunDir(base, state.externalId);
      const srcPath = join(sourceRoot, state.evidenceRef?.key ?? "");
      if (state.evidenceRef?.key && !(await pathExists(srcPath))) {
        materializeAudit.filesMissing++;
      }
      for (const k of state.processedArtifactKeys ?? []) {
        if (!(await pathExists(join(sourceRoot, k)))) {
          materializeAudit.filesMissing++;
        }
      }
    }
  }

  console.log("migrate-scrape-layout");
  console.log(`  source: ${sourceRoot}`);
  console.log(`  target: ${targetRoot} (scrape tree only)`);
  console.log(`  scrape: ${LANE}/${domain}/${scrapeId}`);
  console.log(`  listings: ${states.length}`);
  console.log(`  counts: ${JSON.stringify(counts)}`);
  console.log(`  discovered (refs): ${discovered}`);
  if (!skipMaterialize) {
    console.log(`  materialize audit: ${JSON.stringify(materializeAudit)}`);
  }

  if (checkOnly) {
    return;
  }

  await mkdir(base, { recursive: true });

  const scrapeMeta = {
    version: 1,
    lane: LANE,
    scrapeId,
    domain,
    adapter: ADAPTER,
    catalogUrl: CATALOG_URL,
    createdAt: at,
    nextRunId: RUN_ID + 1,
    latestRunId: RUN_ID,
    cumulative: {
      discovered,
      ingested: counts.ingested,
      failed: counts.failed,
      skippedKnown: counts.skipped_known,
      skippedFresh: counts.skipped_fresh,
      satisfied: counts.satisfied,
      lastUpdatedAt: at,
      lastCompletedRunId: RUN_ID,
    },
    migratedFrom: sourceRoot,
    migrationKind: RUN_KIND,
  };
  await writeFile(
    join(base, "scrape.json"),
    `${JSON.stringify(scrapeMeta, null, 2)}\n`,
    "utf8",
  );

  const runDir = join(base, "runs", String(RUN_ID));
  await mkdir(join(runDir, "discovery"), { recursive: true });
  await writeFile(
    join(runDir, "run.json"),
    `${JSON.stringify(
      {
        version: 1,
        runId: RUN_ID,
        status: "completed",
        kind: RUN_KIND,
        startedAt: at,
        finishedAt: at,
        thisRun: {
          discovered,
          ingested: counts.ingested,
          failed: counts.failed,
          skippedKnown: counts.skipped_known,
          skippedFresh: counts.skipped_fresh,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (refsPath) {
    await copyFile(refsPath, join(runDir, "discovery", "refs.json"));
  }

  let done = 0;
  const copyStats = { filesCopied: 0, filesMissing: 0 };

  for (const state of states) {
    const listingId = state.externalId;
    const runDirListing = listingRunDir(base, listingId);
    await mkdir(runDirListing, { recursive: true });

    await writeFile(
      join(base, "listings", safeListingDirName(listingId), "index.json"),
      `${JSON.stringify(toListingIndex(state, at), null, 2)}\n`,
      "utf8",
    );

    let localArtifacts = [];
    if (
      !skipMaterialize &&
      (state.evidenceRef || state.processedArtifactKeys?.length)
    ) {
      const { stats, localArtifacts: locals } = await materializeListingRun(
        sourceRoot,
        runDirListing,
        state,
      );
      copyStats.filesCopied += stats.copied;
      copyStats.filesMissing += stats.missing;
      localArtifacts = locals;
    }

    if (
      localArtifacts.length > 0 ||
      state.evidenceRef ||
      state.failure ||
      state.status === "failed"
    ) {
      await writeFile(
        join(runDirListing, "manifest.json"),
        `${JSON.stringify(
          buildManifest(state, at, runDirListing, localArtifacts),
          null,
          2,
        )}\n`,
        "utf8",
      );
    }

    done++;
    if (done % 500 === 0) {
      console.log(`  … ${done}/${states.length} listings`);
    }
  }

  let corpusCopied = null;
  if (!skipCorpus) {
    corpusCopied = await copyCorpus(sourceRoot, base);
  }

  console.log(`\nWrote ${base}`);
  if (!skipMaterialize) {
    console.log(`  materialized files: ${JSON.stringify(copyStats)}`);
  }
  if (corpusCopied) {
    console.log(`  corpus: ${JSON.stringify(corpusCopied)}`);
  }
  console.log(
    "\nValidate: jq .cumulative data/scrapes/listings/bizbuysell.com/california-businesses-for-sale/scrape.json",
  );
  console.log(
    "Spot-check: ls data/scrapes/listings/bizbuysell.com/california-businesses-for-sale/listings/1219330/runs/1/",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
