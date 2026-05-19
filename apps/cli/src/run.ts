import { mkdir } from "node:fs/promises";
import type { Readable } from "node:stream";
import { SourceRecordSchema } from "@clearbolt/core";
import {
  BIZBUYSELL_CALIFORNIA_CATALOG_URL,
  isBizBuySellCatalogUrl,
  isBizQuestSearchUrl,
  isBusinessBrokerCatalogUrl,
  parseListingPage,
  parseSearchUrl,
  runBizQuestScrape,
  assertCatalogRefsAdapter,
  assertCatalogIngestSupported,
  catalogAdapterFromUrl,
  defaultCatalogRefsPath,
  formatCatalogSourcesTable,
  isCatalogDiscoveryComplete,
  loadCatalogRefsForAdapter,
  readCatalogRefsFile,
  defaultIngestFailuresPath,
  scrapeAdapterFromUrl,
  listIngestFailureRefs,
  listFailedListingRefsForCatalog,
  beginListingScrapeRun,
  completeListingScrapeRun,
  countListingIndexesOnScrape,
  countListingIngestStatesOnDisk,
  ScrapeRunListingStateStore,
  compositeListingIngestStateStore,
  readScrapeMeta,
  scrapeMetaPath,
  listingScrapeContextFromCatalogUrl,
  countAkamaiHardBlockFailures,
  runBizBuySellScrape,
  runCatalogScrape,
  syncIngestFailuresFromDisk,
  type ResumeCatalogDiscovery,
  BIZBUYSELL_CALIFORNIA_BROKER_DIRECTORY_URL,
  isBizBuySellBrokerDirectoryUrl,
  isBizBuySellBrokerProfileUrl,
  defaultBrokerRefsPath,
  writeBrokerRefsFile,
  runBizBuySellBrokerDirectoryScrapeWithBrowser,
  runBizBuySellBrokerProfileScrapeWithBrowser,
} from "@clearbolt/scraper";
import {
  isBrokerDirectoryAdapterId,
  runBrokerDirectoryDiscovery,
} from "@clearbolt/broker-directory";
import { runBrokerSiteCrawl } from "@clearbolt/broker-site";
import { positionalArgs } from "./argv.js";
import {
  buildCatalogArgsInteractive,
  catalogArgsHaveExplicitMode,
  catalogUrlFromArgs,
  parseCatalogSourceFlag,
} from "./catalog-interactive.js";
import {
  writeCatalogDiscoverOutput,
  writeCatalogIngestOutput,
} from "./catalog-output.js";
import {
  dumpRunEnv,
  parseDumpEnvPath,
  shouldDumpEnvFromArgv,
} from "./dump-env.js";
import { bindStorage, dataRoot } from "./bind-storage.js";
import { stdinIsInteractive } from "./prompt.js";

function logStorageBackends(
  evidenceBackend: "disk" | "r2",
  metadataBackend: "disk" | "neon",
  listingIngestStateBackend?: "disk" | "disk+r2",
): void {
  if (evidenceBackend === "r2") console.log("evidence: R2");
  if (metadataBackend === "neon") console.log("metadata: Neon");
  if (listingIngestStateBackend === "disk+r2") {
    console.log("listing ingest state: disk + R2 (listing-ingest-state/…)");
  }
}

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseHostArg(raw: string): string {
  const s = raw.trim();
  if (!s) throw new Error("host required");
  try {
    if (s.includes("://")) return new URL(s).hostname;
    return new URL(`https://${s}`).hostname;
  } catch {
    throw new Error(`invalid host: ${raw}`);
  }
}

async function cmdDomain(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "-h") {
    throw new Error(
      "usage: clearbolt domain show <host>\n       clearbolt domain mark <host> --browser | --http",
    );
  }
  const root = dataRoot();
  await mkdir(root, { recursive: true });
  const { metadata: meta, disconnect } = await bindStorage();
  try {
    if (sub === "show") {
      const hostArg = args[1];
      if (!hostArg) throw new Error("usage: clearbolt domain show <host>");
      const host = parseHostArg(hostArg);
      const p = await meta.getDomainProfile(host);
      console.log(p ? JSON.stringify(p, null, 2) : `no profile for ${host}`);
      return;
    }

    if (sub === "mark") {
      const hostArg = args[1];
      if (!hostArg)
        throw new Error(
          "usage: clearbolt domain mark <host> --browser | --http",
        );
      const host = parseHostArg(hostArg);
      const flags = args.slice(2);
      const wantBrowser = flags.includes("--browser");
      const wantHttp = flags.includes("--http");
      if (wantBrowser === wantHttp) {
        throw new Error("mark requires exactly one of --browser or --http");
      }
      await meta.putDomainProfile({
        host,
        needsBrowser: wantBrowser,
        lastUpdatedAt: new Date().toISOString(),
      });
      console.log(`domain ${host} needsBrowser=${wantBrowser}`);
      return;
    }

    throw new Error(`unknown domain subcommand: ${sub}`);
  } finally {
    await disconnect?.();
  }
}

export async function runCli(argv: string[]): Promise<void> {
  const [, , cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "-h") {
    console.log(`clearbolt scrape <search-url> [--fixtures]
  BizBuySell or BizQuest search URL (auto-detected from host/path)
clearbolt catalog [--source <id>] [<catalog-url>] [flags…]
  -i, --interactive                        pick source + mode (TTY)
  --list-sources                           print marketplace catalog registry
  --discover-only --discover-out path.json save listing URLs, skip ingest
  --refs-file path.json                      ingest only (skip catalog walk)
  --refresh / --force-discovery / --retry-failures-only
  --dump-env [path]                          write data/debug/env-dump-*.json (or CLEARBOLT_DUMP_ENV=1)
  --pages N --ingest N --fixtures --headed
  Default (no URL): BizBuySell CA catalog, or interactive when TTY
  Per-adapter data: catalog-refs/<adapter>/…, ingest-failures/<adapter>.json
  Run \`clearbolt catalog --list-sources\` for defaults and ingest/browser notes
clearbolt deals list
clearbolt replay
clearbolt domain show <host>
clearbolt domain mark <host> --browser | --http
clearbolt broker discover [<directory-url>] [--adapter id] [--country XX] [--state XX] [--city City] [--last-name Name] [--discover-out path.json] [--pages N] [--headed]
clearbolt broker scrape <profile-url> [--discover-only] [--ingest N] [--headed]
  Adapters: bizbuysell (default), ibba, transworld, sunbelt, state-dre-ca, state-dre-fl, state-dre-az
  Examples: clearbolt broker discover --adapter ibba --country US
            clearbolt broker discover --adapter ibba --country CA
            clearbolt broker discover --adapter ibba --country US --state TX
            (IBBA: --country CA = Canada; --state CA = California)
            clearbolt broker discover --adapter transworld
            clearbolt broker discover --adapter state-dre-ca --city "Los Angeles"
  Default BBS directory: BizBuySell CA broker directory
  Broker refs: broker-refs/<adapter>/<slug>.json (no Prisma migration required)
clearbolt env-dump [path]
  Redacted CLEARBOLT_* / DATA_DIR env + resolved scraper flags (default: data/debug/env-dump-<timestamp>.json)
clearbolt broker-site crawl <broker-website-url> [--discover-only] [--ingest N] [--pages N] [--crawl-out path.json]
  Independent broker-owned sites only (marketplace hosts blocked)
  Checkpoints: broker-site-crawls/<host>__<path>.json (pagination per index URL; auto-resume)
  Optional: CLEARBOLT_BROKER_SITE_ALLOWLIST=domain.com,other.com
  Optional: CLEARBOLT_BROKER_SITE_MAX_INDEX_PAGES (default 0 = all pages; --pages N caps per index)
  Optional: CLEARBOLT_BROKER_SITE_LLM_EXTRACT=1 + OPENROUTER_API_KEY for bespoke sites

Env:
  DATA_DIR (default ./data)
  CLEARBOLT_SCRAPE_LIMIT (default 10)
  CLEARBOLT_CATALOG_MAX_PAGES (default 0 = all pages until no next; set e.g. 200 to cap)
  --pages N (omit or 0 = all catalog pages; use N to limit discovery)
  --ingest N (ingest N listings; also stops discovery at N unless --max-listings overrides)
  CLEARBOLT_CATALOG_MAX_LISTINGS (default 0 = no cap; --ingest N implies cap N)
  CLEARBOLT_LISTING_FETCH_SKIP_KNOWN=1   set automatically on resume; --refresh forces 0
  CLEARBOLT_SKIP_BROWSER=1 (no Playwright session for scrape)
  CLEARBOLT_STORAGE=cloud — use R2 + Neon (.env.dev / .env.cloud.local); default is disk
  --fixtures uses packages/scraper/tests/fixtures/bizbuysell-live-cache.json when present (pnpm fixtures:refresh), else static HTML
  CLEARBOLT_DEDUP_EMBED=1 — optional OpenRouter embeddings on listing HTML text (needs OPENROUTER_API_KEY; CLEARBOLT_DEDUP_EMBED_MODEL optional — when unset, picks free then cheapest from OpenRouter embeddings catalog)`);
    return;
  }
  if (cmd === "scrape") {
    await cmdScrape(rest);
    return;
  }
  if (cmd === "catalog") {
    await cmdCatalog(rest);
    return;
  }
  if (cmd === "env-dump") {
    const { rest: dumpRest, dumpPath } = parseDumpEnvPath(rest);
    const path = await dumpRunEnv({
      argv: process.argv.slice(2),
      outPath: dumpPath ?? dumpRest[0],
    });
    console.log(`env dump: ${path}`);
    return;
  }
  if (cmd === "deals" && rest[0] === "list") {
    await cmdDealsList();
    return;
  }
  if (cmd === "replay") {
    await cmdReplay();
    return;
  }
  if (cmd === "domain") {
    await cmdDomain(rest);
    return;
  }
  if (cmd === "broker") {
    await cmdBroker(rest);
    return;
  }
  if (cmd === "broker-site") {
    await cmdBrokerSite(rest);
    return;
  }
  throw new Error(`unknown command: ${cmd}`);
}

async function cmdBrokerSite(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "-h") {
    throw new Error(
      "usage: clearbolt broker-site crawl <https://broker-domain/> [--discover-only] [--ingest N] [--pages N] [--crawl-out path.json]",
    );
  }
  if (sub !== "crawl") {
    throw new Error(`unknown broker-site subcommand: ${sub}`);
  }

  const discoverOnly = args.includes("--discover-only");
  const ingestLimit = parseFlagInt(args, "--ingest") ?? 0;
  const maxPagesPerIndex = parseFlagInt(args, "--pages");
  const crawlStatePath = parseFlagString(args, "--crawl-out");
  const siteUrl = positionalArgs(args.filter((a) => a !== sub))[0];
  if (!siteUrl) {
    throw new Error("usage: clearbolt broker-site crawl <broker-website-url>");
  }

  const root = dataRoot();
  await mkdir(root, { recursive: true });
  const {
    evidence,
    processedArtifacts,
    metadata: meta,
    disconnect,
    evidenceBackend,
    metadataBackend,
  } = await bindStorage();

  try {
    logStorageBackends(evidenceBackend, metadataBackend);
    const result = await runBrokerSiteCrawl({
      siteUrl,
      evidence,
      processedArtifacts,
      metadata: meta,
      discoverOnly,
      ingestLimit,
      dataRootDir: root,
      ...(maxPagesPerIndex !== undefined ? { maxPagesPerIndex } : {}),
      ...(crawlStatePath ? { crawlStatePath } : {}),
      onProgress: (ev) => console.log(`[${ev.phase}] ${ev.message}`),
      onIngested: ({ record, result: r }) => {
        console.log(
          `${record.externalId ?? record.url} -> canonical ${r.canonicalId} (${r.action}) [broker-site]`,
        );
      },
    });

    if (result.crawlStatePath) {
      console.log(`crawl state: ${result.crawlStatePath}`);
      for (const p of result.indexPagination) {
        console.log(
          `  index ${p.indexUrl}: ${p.pagesFetched} page(s)${p.lastPaginationStrategy ? ` (${p.lastPaginationStrategy})` : ""}${p.complete ? " [complete]" : ` next=${p.nextPageUrl ?? "?"}`}`,
        );
      }
    }

    if (discoverOnly || ingestLimit === 0) {
      console.log(`discovered ${result.listingLinksDiscovered} listing URL(s):`);
      for (const u of result.listingUrls.slice(0, 50)) {
        console.log(`  ${u}`);
      }
      if (result.listingUrls.length > 50) {
        console.log(`  … and ${result.listingUrls.length - 50} more`);
      }
    } else {
      console.log(
        `ingested ${result.listingsIngested} listing(s) from ${siteUrl} (adapter: broker-site)`,
      );
    }
  } finally {
    await disconnect?.();
  }
}

async function cmdBroker(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "-h") {
    throw new Error(
      "usage: clearbolt broker discover [<directory-url>] [--adapter id] [--state XX] [--city City] [--discover-out path.json] [--pages N]\n" +
        "       clearbolt broker scrape <profile-url> [--discover-only] [--ingest N]",
    );
  }

  const root = dataRoot();
  await mkdir(root, { recursive: true });
  const {
    evidence,
    processedArtifacts,
    metadata: meta,
    listingIngestState,
    disconnect,
    evidenceBackend,
    metadataBackend,
  } = await bindStorage();

  const skipBrowser = process.env.CLEARBOLT_SKIP_BROWSER === "1";
  const headed = parseHeadedMode(args);
  const discoverOnly = args.includes("--discover-only");
  const discoverOut = parseFlagString(args, "--discover-out");
  const maxPages =
    parseFlagInt(args, "--pages") ??
    Number.parseInt(process.env.CLEARBOLT_CATALOG_MAX_PAGES ?? "0", 10);
  const ingestLimit = parseFlagInt(args, "--ingest") ?? 0;

  try {
    logStorageBackends(evidenceBackend, metadataBackend);

    if (sub === "discover") {
      const adapterFlag = parseFlagString(args, "--adapter");
      const stateCode = parseFlagString(args, "--state");
      const countryCode = parseFlagString(args, "--country");
      const city = parseFlagString(args, "--city");
      const lastName = parseFlagString(args, "--last-name");

      if (adapterFlag && adapterFlag !== "bizbuysell") {
        if (!isBrokerDirectoryAdapterId(adapterFlag)) {
          throw new Error(
            `Unknown broker directory adapter: ${adapterFlag}. Use: ibba, transworld, sunbelt, state-dre-ca, state-dre-fl, state-dre-az`,
          );
        }
        const result = await runBrokerDirectoryDiscovery({
          adapter: adapterFlag,
          dataRootDir: root,
          discoverOut,
          stateCode,
          countryCode,
          city,
          lastName,
          onProgress: (msg) => console.log(`[discovery] ${msg}`),
        });
        console.log(
          `discovered ${result.refs.length} broker ref(s) via ${result.adapter} → ${result.outputPath}`,
        );
        const withWeb = result.refs.filter((r) => r.websiteDomain).length;
        if (withWeb > 0) {
          console.log(`  ${withWeb} with websiteDomain (ready for broker-site crawl after allow-list)`);
        }
        return;
      }

      const urlArg = positionalArgs(args.filter((a) => a !== sub))[0];
      const directoryUrl =
        urlArg?.trim() || BIZBUYSELL_CALIFORNIA_BROKER_DIRECTORY_URL;
      if (!isBizBuySellBrokerDirectoryUrl(directoryUrl)) {
        throw new Error(`Not a BizBuySell broker directory URL: ${directoryUrl}`);
      }
      const defaultRefs = defaultBrokerRefsPath(directoryUrl, root);
      const checkpointPath = discoverOut ?? defaultRefs;

      const result = await runBizBuySellBrokerDirectoryScrapeWithBrowser({
        directoryUrl,
        evidence,
        metadata: meta,
        discoverOnly: true,
        maxPages,
        brokerRefsCheckpointPath: checkpointPath,
        skipBrowser,
        headed,
        onProgress: (ev) => console.log(`[${ev.phase}] ${ev.message}`),
      });

      if (!discoverOut) {
        await writeBrokerRefsFile(defaultRefs, {
          directoryUrl,
          adapter: "bizbuysell",
          refs: result.discoveredBrokerRefs,
          complete: true,
          pagesFetched: result.pagesFetched,
        });
      }

      console.log(
        `discovered ${result.brokersDiscovered} broker profile URL(s) → ${checkpointPath}`,
      );
      return;
    }

    if (sub === "scrape") {
      const profileUrl = positionalArgs(args.filter((a) => a !== sub))[0];
      if (!profileUrl) {
        throw new Error("usage: clearbolt broker scrape <profile-url> [--ingest N]");
      }
      if (!isBizBuySellBrokerProfileUrl(profileUrl)) {
        throw new Error(`Not a BizBuySell broker profile URL: ${profileUrl}`);
      }

      const result = await runBizBuySellBrokerProfileScrapeWithBrowser({
        profileUrl,
        evidence,
        processedArtifacts,
        metadata: meta,
        listingIngestState,
        ingestFailuresPath: defaultIngestFailuresPath(root, "bizbuysell"),
        discoverOnly,
        ingestLimit,
        skipBrowser,
        headed,
        onProgress: (ev) => console.log(`[${ev.phase}] ${ev.message}`),
        onIngested: ({ record, result: r }) => {
          console.log(
            `${record.externalId ?? record.id} -> canonical ${r.canonicalId} (${r.action})`,
          );
        },
      });

      console.log(
        `broker ${result.profile.name ?? result.profileUrl}: ${result.activeListingRefs.length} active listing(s), ingested ${result.listingsIngested}`,
      );
      return;
    }

    throw new Error(`unknown broker subcommand: ${sub}`);
  } finally {
    await disconnect?.();
  }
}

async function cmdScrapeBizQuest(args: string[]): Promise<void> {
  const useFixtures = args.includes("--fixtures");
  const urls = args.filter((a) => !a.startsWith("--"));
  const searchUrlArg = urls[0];
  if (!searchUrlArg)
    throw new Error("usage: clearbolt scrape <bizquest-search-url> [--fixtures]");

  const root = dataRoot();
  await mkdir(root, { recursive: true });
  const {
    evidence,
    processedArtifacts,
    metadata: meta,
    listingIngestState,
    disconnect,
    evidenceBackend,
    metadataBackend,
  } = await bindStorage();
  const limit = Number.parseInt(process.env.CLEARBOLT_SCRAPE_LIMIT ?? "10", 10);
  const skipBrowser = process.env.CLEARBOLT_SKIP_BROWSER === "1";
  const adapter = scrapeAdapterFromUrl(searchUrlArg);

  try {
    logStorageBackends(evidenceBackend, metadataBackend);
    const result = await runBizQuestScrape({
      searchUrl: searchUrlArg,
      evidence,
      processedArtifacts,
      metadata: meta,
      listingIngestState,
      ingestFailuresPath: defaultIngestFailuresPath(root, adapter),
      limit,
      useFixtures,
      skipBrowser,
      onIngested: ({ record, result: r }) => {
        const cu = r.contentUpdated ? " content_updated" : "";
        console.log(
          `${record.id} -> canonical ${r.canonicalId} (${r.action})${cu}`,
        );
      },
    });
    console.log(
      `search evidence: ${result.searchEvidenceKey} (${result.listingsIngested} listings)`,
    );
  } finally {
    await disconnect?.();
  }
}

async function cmdScrape(args: string[]): Promise<void> {
  const useFixtures = args.includes("--fixtures");
  const urls = args.filter((a) => !a.startsWith("--"));
  const searchUrlArg = urls[0];
  if (!searchUrlArg)
    throw new Error("usage: clearbolt scrape <url> [--fixtures]");
  if (isBusinessBrokerCatalogUrl(searchUrlArg)) {
    return cmdCatalog([
      searchUrlArg,
      "--discover-only",
      ...(useFixtures ? ["--fixtures"] : []),
    ]);
  }
  if (isBizBuySellCatalogUrl(searchUrlArg)) {
    const limit = Number.parseInt(
      process.env.CLEARBOLT_SCRAPE_LIMIT ?? "10",
      10,
    );
    const catalogArgs = [
      searchUrlArg,
      "--ingest",
      String(limit),
      ...(useFixtures ? ["--fixtures"] : []),
    ];
    return cmdCatalog(catalogArgs);
  }
  if (isBizQuestSearchUrl(searchUrlArg)) {
    return cmdScrapeBizQuest(args);
  }
  parseSearchUrl(searchUrlArg);

  const root = dataRoot();
  await mkdir(root, { recursive: true });
  const {
    evidence,
    processedArtifacts,
    metadata: meta,
    listingIngestState,
    disconnect,
    evidenceBackend,
    metadataBackend,
  } = await bindStorage();
  const limit = Number.parseInt(process.env.CLEARBOLT_SCRAPE_LIMIT ?? "10", 10);
  const skipBrowser = process.env.CLEARBOLT_SKIP_BROWSER === "1";
  const adapter = scrapeAdapterFromUrl(searchUrlArg);
  const ingestFailuresPath = defaultIngestFailuresPath(root, adapter);

  try {
    logStorageBackends(evidenceBackend, metadataBackend);
    const result = await runBizBuySellScrape({
      searchUrl: searchUrlArg,
      evidence,
      processedArtifacts,
      metadata: meta,
      listingIngestState,
      limit,
      useFixtures,
      skipBrowser,
      ingestFailuresPath,
      dedupEmbed: process.env.CLEARBOLT_DEDUP_EMBED === "1",
      onIngested: ({ record, result: r }) => {
        const cu = r.contentUpdated ? " content_updated" : "";
        console.log(
          `${record.id} -> canonical ${r.canonicalId} (${r.action})${cu}`,
        );
      },
    });
    const serperNote =
      result.serperSupplement && result.serperSupplement > 0
        ? `, serper=+${result.serperSupplement}`
        : "";
    console.log(
      `search evidence: ${result.searchEvidenceKey} (${result.listingsIngested} listings, discovery=${result.discoveryMode}${serperNote})`,
    );
  } finally {
    await disconnect?.();
  }
}

function parseFlagInt(args: string[], flag: string): number | undefined {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return undefined;
  const n = Number.parseInt(args[i + 1], 10);
  return Number.isNaN(n) ? undefined : n;
}

function parseFlagString(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return undefined;
  const v = args[i + 1]?.trim();
  return v || undefined;
}

/** Visible Chromium for Playwright fallback / browser-first (`--headed`, `--headless=0`). */
function parseHeadedMode(args: string[]): boolean {
  if (args.includes("--headed")) return true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--headless=0" || a === "--headless=false") return true;
    if (a.startsWith("--headless=")) {
      const v = a.slice("--headless=".length).trim().toLowerCase();
      if (v === "0" || v === "false") return true;
    }
    if (a === "--headless" && i + 1 < args.length) {
      const v = args[i + 1]!.trim().toLowerCase();
      if (v === "0" || v === "false") return true;
    }
  }
  return false;
}

async function cmdCatalog(args: string[]): Promise<void> {
  if (args.includes("--list-sources") || args[0] === "list-sources") {
    console.log(formatCatalogSourcesTable());
    return;
  }

  const interactiveFlag =
    args.includes("--interactive") || args.includes("-i");
  let runArgs = args.filter(
    (a) => a !== "--interactive" && a !== "-i" && a !== "--list-sources",
  );

  const { sourceId: sourceFlagEarly, rest: argsBeforeInteractive } =
    parseCatalogSourceFlag(runArgs);
  const hasUrl =
    positionalArgs(argsBeforeInteractive).length > 0 || Boolean(sourceFlagEarly);
  if (
    interactiveFlag ||
    (!hasUrl && !catalogArgsHaveExplicitMode(runArgs) && stdinIsInteractive())
  ) {
    const built = await buildCatalogArgsInteractive();
    runArgs = built.args;
  }

  const dumpEnvRequested = shouldDumpEnvFromArgv(runArgs);
  const { rest: runArgsNoDump, dumpPath: dumpEnvPath } = parseDumpEnvPath(runArgs);
  runArgs = runArgsNoDump;

  const { sourceId, rest: catalogArgs } = parseCatalogSourceFlag(runArgs);
  const useFixtures = catalogArgs.includes("--fixtures");
  const discoverOnly = catalogArgs.includes("--discover-only");
  const refresh = catalogArgs.includes("--refresh");
  const retryFailuresOnly = catalogArgs.includes("--retry-failures-only");
  if (retryFailuresOnly && refresh) {
    throw new Error("Use either --retry-failures-only or --refresh, not both");
  }
  const forceDiscovery =
    catalogArgs.includes("--force-discovery") || refresh;
  const headed = parseHeadedMode(catalogArgs);
  const discoverOut = parseFlagString(catalogArgs, "--discover-out");
  let refsFile = parseFlagString(catalogArgs, "--refs-file");
  if (refsFile && discoverOnly) {
    throw new Error("Use either --refs-file (ingest only) or --discover-only, not both");
  }
  if (refresh && refsFile) {
    throw new Error("Use either --refresh or --refs-file, not both");
  }
  if (refresh) {
    process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN = "0";
    console.log(
      "refresh: full catalog walk, re-fetch every listing (SKIP_KNOWN=0, stale-page stop off)",
    );
  }

  let catalogUrl = catalogUrlFromArgs(
    sourceId,
    positionalArgs(catalogArgs)[0],
  );

  const root = dataRoot();
  await mkdir(root, { recursive: true });

  let listingRefsFromFile: Awaited<ReturnType<typeof readCatalogRefsFile>> | undefined;
  let resumeDiscovery: ResumeCatalogDiscovery | undefined;
  let ingestRefsOnly: typeof listingRefsFromFile | undefined;
  let retryFailureRefs: Awaited<
    ReturnType<typeof listIngestFailureRefs>
  > | undefined;

  if (refsFile) {
    listingRefsFromFile = await readCatalogRefsFile(refsFile);
    catalogUrl = listingRefsFromFile.catalogUrl;
    ingestRefsOnly = listingRefsFromFile;
    if (process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN === undefined) {
      process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN = "1";
    }
    console.log(
      `refs-file: ${refsFile} (${listingRefsFromFile.refs.length} listings; SKIP_KNOWN=1)`,
    );
  }

  const catalogAdapter = catalogAdapterFromUrl(catalogUrl);

  if (refsFile && listingRefsFromFile) {
    assertCatalogRefsAdapter(listingRefsFromFile, catalogAdapter);
  } else if (!discoverOnly && !forceDiscovery && !retryFailuresOnly) {
    const loaded = await loadCatalogRefsForAdapter(
      catalogUrl,
      catalogAdapter,
      root,
    );
    const cachedRefs = loaded?.file;
    const cachedRefsPath = loaded?.path;
    if (
      cachedRefs &&
      !refresh &&
      !isCatalogDiscoveryComplete(cachedRefs) &&
      cachedRefs.nextPageUrl
    ) {
      catalogUrl = cachedRefs.catalogUrl;
      resumeDiscovery = {
        refs: cachedRefs.refs,
        startUrl: cachedRefs.nextPageUrl,
        pagesFetched: cachedRefs.pagesFetched,
      };
      console.log(
        `resume discovery: continuing from page ${(cachedRefs.pagesFetched ?? 0) + 1} ` +
          `(${cachedRefs.refs.length} refs checkpointed at ${cachedRefsPath})`,
      );
    } else if (cachedRefs && isCatalogDiscoveryComplete(cachedRefs)) {
      listingRefsFromFile = cachedRefs;
      catalogUrl = cachedRefs.catalogUrl;
      ingestRefsOnly = cachedRefs;
      if (process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN === undefined) {
        process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN = "1";
      }
      console.log(
        `mode: catalog-resume (${cachedRefs.refs.length} listings from cache; failures deferred unless --retry-failures-only)`,
      );
      console.log(
        `resume ingest: ${cachedRefsPath} (${cachedRefs.refs.length} listings; SKIP_KNOWN=1; --refresh to rediscover)`,
      );
    }
  } else if (forceDiscovery && !refresh) {
    console.log(
      "force-discovery: re-walking catalog (cached refs ignored; ingest still respects SKIP_KNOWN unless set)",
    );
  }

  const defaultRefsPath = defaultCatalogRefsPath(catalogUrl, root);
  const checkpointPath = discoverOut ?? defaultRefsPath;
  const ingestFailuresPath = defaultIngestFailuresPath(root, catalogAdapter);
  const failuresCollection = await syncIngestFailuresFromDisk(
    root,
    catalogAdapter,
    ingestFailuresPath,
  );
  const failureCount = Object.keys(failuresCollection.failures).length;
  if (failureCount > 0) {
    const hardBlocks = Object.values(failuresCollection.failures).filter(
      (f) =>
        f.message.toLowerCase().includes("hard block") ||
        f.message.toLowerCase().includes("not retriable"),
    ).length;
    const retryNote =
      hardBlocks === failureCount
        ? "deferred on normal resume (use --retry-failures-only after fresh proxy)"
        : "retriable failures only on --retry-failures-only";
    console.log(
      `ingest failures (${catalogAdapter}): ${failureCount} at ${ingestFailuresPath} (${retryNote})`,
    );
    const sample = Object.values(failuresCollection.failures).slice(0, 8);
    for (const f of sample) {
      const msg =
        f.message.length > 100 ? `${f.message.slice(0, 97)}…` : f.message;
      console.log(`  ${f.externalId}: ${msg}`);
    }
    if (failureCount > sample.length) {
      console.log(`  … and ${failureCount - sample.length} more`);
    }
  }

  if (retryFailuresOnly) {
    const failureCatalogUrl = catalogUrl || BIZBUYSELL_CALIFORNIA_CATALOG_URL;
    const failureRefs = await listFailedListingRefsForCatalog(
      root,
      failureCatalogUrl,
      catalogAdapter,
    );
    if (failureRefs.length === 0) {
      console.log("retry-failures-only: no listings with status=failed on disk");
      return;
    }
    if (!catalogUrl) {
      catalogUrl = BIZBUYSELL_CALIFORNIA_CATALOG_URL;
    }
    retryFailureRefs = failureRefs;
    process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN = "0";
    /** Prior failures are often m. hard blocks; retry on www first. */
    process.env.CLEARBOLT_BIZBUYSELL_LISTING_PREFER_MOBILE = "0";
    const hardBlocks = countAkamaiHardBlockFailures(failuresCollection);
    console.log(
      `mode: retry-failures-only (${failureRefs.length} failed listing(s) only; catalog walk skipped)`,
    );
    console.log(
      `retry-failures-only: re-fetching ${failureRefs.length} failed listing(s)` +
        (hardBlocks > 0
          ? ` (${hardBlocks} were Akamai hard blocks — use a new CLEARBOLT_PROXY_SESSION_ID and/or --headed)`
          : ""),
    );
  }

  assertCatalogIngestSupported(catalogUrl, discoverOnly, Boolean(refsFile));
  if (listingRefsFromFile) {
    assertCatalogRefsAdapter(listingRefsFromFile, catalogAdapter);
  }

  if (dumpEnvRequested) {
    const envDumpFile = await dumpRunEnv({
      argv: process.argv.slice(2),
      outPath: dumpEnvPath,
      notes: {
        retryFailuresOnly,
        discoverOnly,
        refresh,
        forceDiscovery,
        headed,
        catalogAdapter,
        failureRefsToRetry: retryFailureRefs?.length ?? 0,
      },
    });
    console.log(`env dump: ${envDumpFile}`);
    if (process.env.CLEARBOLT_DUMP_ENV_ONLY?.trim() === "1") {
      return;
    }
  }

  const catalogSource = catalogAdapter;
  const maxPages = parseFlagInt(catalogArgs, "--pages");
  const ingestLimit = parseFlagInt(catalogArgs, "--ingest");
  const maxListingsExplicit = parseFlagInt(catalogArgs, "--max-listings");
  /** Stop catalog pagination once enough refs for `--ingest` (unless `--max-listings` set). */
  const maxListings =
    maxListingsExplicit ??
    (!discoverOnly && ingestLimit != null && ingestLimit > 0
      ? ingestLimit
      : undefined);

  const {
    evidence,
    processedArtifacts,
    metadata: meta,
    listingIngestState: baseListingIngestState,
    disconnect,
    evidenceBackend,
    metadataBackend,
    listingIngestStateBackend,
  } = await bindStorage();
  const skipBrowser = process.env.CLEARBOLT_SKIP_BROWSER === "1";

  const catalogRunKind = retryFailuresOnly
    ? "retry-failures"
    : refresh
      ? "refresh"
      : refsFile
        ? "refs-ingest"
        : resumeDiscovery
          ? "resume-discovery"
          : discoverOnly
            ? "discover-only"
            : "catalog";

  const scrapeCtx = discoverOnly
    ? undefined
    : await beginListingScrapeRun({
        dataRoot: root,
        catalogUrl,
        runKind: catalogRunKind,
      });

  const listingIngestState =
    scrapeCtx == null
      ? baseListingIngestState
      : compositeListingIngestStateStore(
          new ScrapeRunListingStateStore(scrapeCtx),
          baseListingIngestState,
        );

  try {
    logStorageBackends(
      evidenceBackend,
      metadataBackend,
      listingIngestStateBackend,
    );
    if (scrapeCtx) {
      const { lane, domain, scrapeId } = scrapeCtx;
      console.log(
        `scrape run: ${lane}/${domain}/${scrapeId} run #${scrapeCtx.runId} (${catalogRunKind})`,
      );
    }
    console.log(`catalog (${catalogSource}): ${catalogUrl}`);

    if (headed) {
      process.env.CLEARBOLT_BROWSER_HEADLESS = "0";
      console.log(
        "Playwright headed mode — Chromium window will stay open during scrape",
      );
    }

    const skipDiscovery =
      Boolean(ingestRefsOnly || retryFailureRefs) && !resumeDiscovery;
    const result = await runCatalogScrape({
      catalogUrl,
      evidence,
      processedArtifacts,
      metadata: meta,
      listingIngestState,
      ingestFailuresPath,
      prioritizeIngestFailures: Boolean(retryFailureRefs),
      useFixtures,
      skipBrowser,
      headed,
      maxPages: skipDiscovery ? 0 : maxPages,
      maxListings,
      ingestLimit: discoverOnly ? 0 : ingestLimit,
      discoverOnly,
      listingRefs: retryFailureRefs ?? ingestRefsOnly?.refs,
      resumeCatalogDiscovery: resumeDiscovery,
      catalogRefsCheckpointPath:
        ingestRefsOnly || retryFailureRefs ? undefined : checkpointPath,
      refreshCatalog: refresh,
      dedupEmbed: process.env.CLEARBOLT_DEDUP_EMBED === "1",
      onProgress: (ev) => {
        if (ev.phase === "ingest") {
          console.log(`[ingest] ${ev.message}`);
          return;
        }
        const prog =
          ev.current != null && ev.total != null
            ? ` (${ev.current}/${ev.total})`
            : "";
        console.log(`[${ev.phase}] ${ev.message}${prog}`);
      },
      onIngested: ({ record, result: r }) => {
        const broker = record.parsedFields.brokerName
          ? ` broker=${record.parsedFields.brokerName}`
          : "";
        const id = record.externalId ?? record.id;
        console.log(
          `${id} -> canonical ${r.canonicalId} (${r.action})${broker}`,
        );
      },
    });

    if (discoverOnly) {
      await writeCatalogDiscoverOutput({
        result,
        catalogUrl,
        adapter: catalogAdapter,
        discoverOut,
        defaultRefsPath,
        logUrls: true,
      });
    } else {
      let overall = scrapeCtx
        ? await completeListingScrapeRun(scrapeCtx, result, {
            catalogRefsPath: refsFile ?? defaultRefsPath,
          })
        : undefined;
      if (!overall) {
        const ctx = listingScrapeContextFromCatalogUrl(root, catalogUrl);
        const meta = await readScrapeMeta(
          scrapeMetaPath(root, ctx.lane, ctx.domain, ctx.scrapeId),
        );
        const stateCounts = meta
          ? await countListingIndexesOnScrape(
              root,
              ctx.lane,
              ctx.domain,
              ctx.scrapeId,
            )
          : await countListingIngestStatesOnDisk(root, catalogAdapter);
        overall = {
          ingested: stateCounts.ingested,
          failed: stateCounts.failed,
          skippedKnown: stateCounts.skipped_known,
          skippedFresh: stateCounts.skipped_fresh,
          satisfied:
            stateCounts.ingested +
            stateCounts.skipped_known +
            stateCounts.skipped_fresh,
        };
      }
      await writeCatalogIngestOutput({
        result: { ...result, overall },
        catalogUrl,
        adapter: catalogAdapter,
        defaultRefsPath,
      });
    }
  } finally {
    await disconnect?.();
  }
}

async function cmdDealsList(): Promise<void> {
  const {
    metadata: meta,
    disconnect,
    evidenceBackend,
    metadataBackend,
  } = await bindStorage();
  try {
    logStorageBackends(evidenceBackend, metadataBackend);
    const ids = await meta.listCanonicalIds();
    for (const id of ids.sort()) {
      const d = await meta.getCanonical(id);
      if (!d) continue;
      const rep = await meta.getSource(d.representativeSourceId);
      const adapter = rep?.adapter ?? "?";
      console.log(
        `${id}\tadapter=${adapter}\tsources=${d.sourceIds.length}\trep=${d.representativeSourceId}`,
      );
    }
  } finally {
    await disconnect?.();
  }
}

async function cmdReplay(): Promise<void> {
  const {
    evidence,
    metadata: meta,
    disconnect,
    evidenceBackend,
    metadataBackend,
  } = await bindStorage();
  try {
    logStorageBackends(evidenceBackend, metadataBackend);
    const ids = await meta.listSourceIds();
    for (const sid of ids) {
      const src = await meta.getSource(sid);
      if (!src) continue;
      const parsed = SourceRecordSchema.safeParse(src);
      if (!parsed.success) throw new Error(`invalid source ${sid}`);
      const stream = await evidence.get(parsed.data.evidenceRef);
      const html = await streamToString(stream);
      const again = parseListingPage(html, parsed.data.url);
      const ex0 = parsed.data.externalId;
      const ex1 = again.externalId;
      if (ex0 !== ex1) {
        throw new Error(`replay mismatch ${sid}: externalId ${ex0} vs ${ex1}`);
      }
    }
    console.log(`replay ok (${ids.length} sources)`);
  } finally {
    await disconnect?.();
  }
}
