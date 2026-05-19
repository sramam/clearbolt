import type { ListingRef, SourceRecord } from "@clearbolt/core";
import {
  BizBuySellDedupKeyer,
  embedTextOpenRouter,
  ingestSourceRecord,
  resolveDedupEmbedOpenRouterModel,
  shouldSkipListingFetch,
} from "@clearbolt/dedup";
import type { IngestSourceResult } from "@clearbolt/dedup";
import { listingFetchMinIntervalMs } from "@clearbolt/dedup";
import type {
  EvidenceStore,
  MetadataStore,
  ProcessedArtifactStore,
} from "@clearbolt/storage";
import { enrichListingExtract } from "./adapters/bizbuysell-listing-enrich.js";
import {
  parseBizBuySellListingPage,
  toParsedListingFields,
} from "./adapters/bizbuysell-listing-parse.js";
import {
  BIZBUYSELL_ADAPTER_ID,
  buildSourceRecord,
  discoverListingRefs,
  fetchListingHtmlWithWafPolicy,
  parseSearchUrl,
} from "./adapters/bizbuysell.js";
import { listingRefFromBizBuySellUrl } from "./bizbuysell-listing-url.js";
import {
  type BizBuySellDiscoveryMode,
  listingIngestWafPolicy,
  primeBizBuySellResidentialHosts,
  resolveBizBuySellDiscoveryMode,
  resolveBrowserFallbackWorkerCount,
  resolveListingIngestConcurrency,
  serperSupplementEnabled,
  shouldPreferHttpIngestForBizBuySell,
  shouldUseBrowserFirstForBizBuySell,
  shouldUseHttpProxyFirstForBizBuySell,
  supplementListingRefsFromSerper,
} from "./bizbuysell-run-policy.js";
import { discoverBizBuySellListingRefsFromSerper } from "./bizbuysell-serper-discovery.js";
import { fetchHtmlWithHttpWafPolicy } from "./fetch-with-waf-policy.js";
import type { FetchHtmlWithHttpWafPolicyOptions } from "./fetch-with-waf-policy.js";
import type { Fetcher } from "./fetcher.js";
import { buildBizBuySellFixtureFetcher } from "./fixtures/build-bizbuysell-fixture-fetcher.js";
import {
  htmlListingBodyFingerprint,
  htmlListingBodyText,
} from "./html-body-fingerprint.js";
import { HttpFetcher } from "./http-fetcher.js";
import {
  clearIngestFailure,
  countNonRetriableIngestFailures,
  isNonRetriableIngestFailureMessage,
  orderListingRefsForIngest,
  readIngestFailuresCollection,
  recordIngestFailure,
} from "./ingest-failure-collection.js";
import { IngestFailureCollector } from "./ingest-failure-log.js";
import { persistListingProcessedArtifacts } from "./listing-artifacts.js";
import {
  type ListingIngestStateStore,
  buildListingIngestState,
  countSatisfiedInRefList,
  externalIdFromListingRef,
  failureTraceFromError,
  isSatisfiedListingStatus,
} from "./listing-ingest-state.js";
import { mapConcurrent } from "./map-concurrent.js";
import { proxySessionKeyFromEnv } from "./proxy-config.js";
import { residentialProxyEndpointCount } from "./proxy-config.js";
import { proxySessionRotateWindowMs } from "./proxy-session-rotate.js";
import {
  type RotatingFetcherCloser,
  createRotatingBrowserFetcher,
  createRotatingHttpFetcher,
} from "./rotating-proxy-fetcher.js";
import { serializedFetcher } from "./serialized-fetcher.js";
import { akamaiHardBlockProxyRetryAttempts } from "./waf-retry-policy.js";

export type { BizBuySellDiscoveryMode } from "./bizbuysell-run-policy.js";

export interface ScrapeProgressEvent {
  phase: "discovery" | "fetch" | "process" | "ingest" | "dedup";
  message: string;
  current?: number;
  total?: number;
}

export interface RunBizBuySellScrapeOptions {
  evidence: EvidenceStore;
  metadata: MetadataStore;
  /** Processed blobs (markdown, structured, embeddings, classification) on R2/disk. */
  processedArtifacts: ProcessedArtifactStore;
  searchUrl: string;
  /** Keywords for Serper discovery (defaults to `q=` on searchUrl when omitted). */
  searchKeywords?: string;
  limit?: number;
  useFixtures?: boolean;
  /**
   * How to discover listing URLs. Default: direct BizBuySell HTML; Serper only supplements
   * when `CLEARBOLT_BIZBUYSELL_SERPER_SUPPLEMENT` is not `0`. Use `serper` to force Serper-only.
   */
  discovery?: "direct" | "serper" | "fixtures";
  /** Optional Playwright-backed fetcher for WAF escalation. */
  browserFetcher?: Fetcher;
  dedupEmbed?: boolean;
  onIngested?: (args: {
    record: SourceRecord;
    result: IngestSourceResult;
  }) => void;
  onProgress?: (event: ScrapeProgressEvent) => void;
  /** Parallel listing fetches (default 4, env `CLEARBOLT_SCRAPE_CONCURRENCY`). */
  concurrency?: number;
  /** Per-listing ingest status on disk/R2 (`listing-ingest-state/<adapter>/<id>/`). */
  listingIngestState?: ListingIngestStateStore;
  /** Aggregate failed listings (`<DATA_DIR>/ingest-failures/<adapter>.json`). */
  ingestFailuresPath?: string;
  /** Retry failures before other refs (`clearbolt catalog --retry-failures-only`). */
  prioritizeIngestFailures?: boolean;
}

export interface RunBizBuySellScrapeResult {
  listingsIngested: number;
  listingsFailed?: number;
  listingsSkippedKnown?: number;
  listingsSkippedFresh?: number;
  searchEvidenceKey: string;
  effectiveSearchUrl: string;
  discoveryMode: BizBuySellDiscoveryMode;
  /** Canonical deal ids touched by this run (for UI "just fetched"). */
  canonicalIds: string[];
  /** Extra listings merged from Serper after direct/catalog discovery (0 if none). */
  serperSupplement?: number;
}

export { resolveBizBuySellDiscoveryMode } from "./bizbuysell-run-policy.js";

function keywordsFromSearchUrl(searchUrl: string): string {
  try {
    const u = new URL(searchUrl);
    return u.searchParams.get("q")?.trim() ?? "";
  } catch {
    return "";
  }
}

type IngestOneListingResult = "ingested" | "skipped_fresh" | "skipped_known";

export type ListingIngestRunStats = {
  listingsIngested: number;
  listingsFailed: number;
  listingsSkippedKnown: number;
  listingsSkippedFresh: number;
};

async function ingestOneListing(
  options: ListingIngestOptions,
  fetcher: Fetcher,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
  ref: ListingRef,
  keyer: BizBuySellDedupKeyer,
): Promise<IngestOneListingResult> {
  const listingIdForState =
    externalIdFromListingRef(ref) ?? ref.externalId ?? null;
  const stateSkip = await skipFromListingIngestState(
    options.listingIngestState,
    BIZBUYSELL_ADAPTER_ID,
    ref,
    Date.now(),
    { retryFailures: options.prioritizeIngestFailures === true },
  );
  if (stateSkip) {
    await persistListingSkipState(options.listingIngestState, {
      adapter: BIZBUYSELL_ADAPTER_ID,
      externalId: listingIdForState ?? ref.url,
      url: ref.url,
      status: stateSkip,
    });
    return stateSkip;
  }

  const freshness =
    options.prioritizeIngestFailures === true
      ? { skip: false as const, lastFetchAt: null, minIntervalMs: 0 }
      : await shouldSkipListingFetch(options.metadata, keyer, {
          adapter: BIZBUYSELL_ADAPTER_ID,
          url: ref.url,
          externalId: ref.externalId,
        });
  if (freshness.skip) {
    const skipped =
      freshness.reason === "known" ? "skipped_known" : "skipped_fresh";
    await persistListingSkipState(options.listingIngestState, {
      adapter: BIZBUYSELL_ADAPTER_ID,
      externalId: listingIdForState ?? ref.url,
      url: ref.url,
      status: skipped,
    });
    return skipped;
  }

  const { html, finalUrl } = await fetchListingHtmlWithWafPolicy(fetcher, ref, {
    ...wafPolicy,
    desktopFirst: options.prioritizeIngestFailures === true,
  });
  const detailBuf = Buffer.from(html, "utf8");
  const evRef = await options.evidence.put(detailBuf, {
    adapter: BIZBUYSELL_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: finalUrl,
  });
  const extract = parseBizBuySellListingPage(html, finalUrl);
  await enrichListingExtract(extract, html, { fetcher, wafPolicy });
  const listingId =
    ref.externalId ??
    listingRefFromBizBuySellUrl(finalUrl)?.externalId ??
    extract.externalId ??
    extract.listingId;
  const parsed = toParsedListingFields({
    ...extract,
    externalId: listingId,
    listingId: listingId ?? extract.listingId,
  });
  const bodyFingerprint = htmlListingBodyFingerprint(html);
  let bodyEmbedding: number[] | undefined;
  let bodyEmbeddingModel: string | undefined;
  const dedupEmbed =
    options.dedupEmbed ?? process.env.CLEARBOLT_DEDUP_EMBED === "1";
  if (dedupEmbed) {
    options.onProgress?.({
      phase: "dedup",
      message: "Embedding listing for dedup…",
    });
    try {
      const text = htmlListingBodyText(html).slice(0, 12_000) || " ";
      const embedModel =
        process.env.CLEARBOLT_DEDUP_EMBED_MODEL?.trim() ??
        (await resolveDedupEmbedOpenRouterModel());
      const vec = await embedTextOpenRouter(text, { model: embedModel });
      if (vec) {
        bodyEmbedding = vec;
        bodyEmbeddingModel = embedModel;
      }
    } catch {
      /* optional */
    }
  }
  options.onProgress?.({
    phase: "process",
    message: "Storing processed artifacts (markdown, structured, …)",
  });
  const processedArtifacts = await persistListingProcessedArtifacts(
    options.processedArtifacts,
    {
      adapter: BIZBUYSELL_ADAPTER_ID,
      sourceUrl: finalUrl,
      rawEvidenceSha256: evRef.sha256,
      html,
      parsed: { ...extract, externalId: listingId, listingId },
      bodyEmbedding,
      bodyEmbeddingModel,
    },
  );

  const record = buildSourceRecord({
    url: finalUrl,
    adapter: BIZBUYSELL_ADAPTER_ID,
    parsed,
    externalId: listingId,
    evidenceRef: evRef,
    processedArtifacts,
    bodyFingerprint,
    bodyEmbedding,
    bodyEmbeddingModel,
  });
  const ingestResult = await ingestSourceRecord(options.metadata, record, {
    keyer,
  });
  options.onIngested?.({ record, result: ingestResult });
  await persistListingIngestState(options.listingIngestState, {
    adapter: BIZBUYSELL_ADAPTER_ID,
    externalId: listingId ?? ref.url,
    url: finalUrl,
    status: "ingested",
    sourceRecordId: record.id,
    canonicalId: ingestResult.canonicalId,
    evidenceRef: evRef,
    processedArtifactKeys: Object.values(processedArtifacts)
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => r.key),
  });
  if (listingId && options.ingestFailuresPath) {
    await clearIngestFailure(options.ingestFailuresPath, listingId).catch(
      () => undefined,
    );
  }
  return "ingested";
}

export type ListingIngestOptions = Pick<
  RunBizBuySellScrapeOptions,
  | "evidence"
  | "processedArtifacts"
  | "metadata"
  | "useFixtures"
  | "browserFetcher"
  | "dedupEmbed"
  | "onIngested"
  | "onProgress"
  | "concurrency"
  | "listingIngestState"
  | "ingestFailuresPath"
  | "prioritizeIngestFailures"
>;

async function persistListingIngestState(
  store: ListingIngestStateStore | undefined,
  state: Parameters<typeof buildListingIngestState>[0],
): Promise<void> {
  if (!store) return;
  await store.put(buildListingIngestState(state));
}

/** Do not downgrade `ingested` → `skipped_*` when persisting a skip outcome. */
async function persistListingSkipState(
  store: ListingIngestStateStore | undefined,
  state: Parameters<typeof buildListingIngestState>[0],
): Promise<void> {
  if (!store) return;
  const prior = await store.get(state.adapter, state.externalId);
  if (isSatisfiedListingStatus(prior?.status)) return;
  await persistListingIngestState(store, state);
}

async function skipFromListingIngestState(
  store: ListingIngestStateStore | undefined,
  adapter: string,
  ref: ListingRef,
  nowMs: number,
  options?: { retryFailures?: boolean },
): Promise<IngestOneListingResult | null> {
  const externalId = externalIdFromListingRef(ref);
  if (!store || !externalId) return null;
  const prior = await store.get(adapter, externalId);
  if (!prior) return null;
  if (options?.retryFailures && prior.status === "failed") {
    return null;
  }
  const minIntervalMs = listingFetchMinIntervalMs();
  const lastAt = new Date(prior.at);
  if (isSatisfiedListingStatus(prior.status)) {
    if (process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN?.trim() === "1") {
      return "skipped_known";
    }
    if (
      minIntervalMs > 0 &&
      !Number.isNaN(lastAt.getTime()) &&
      nowMs - lastAt.getTime() < minIntervalMs
    ) {
      return "skipped_fresh";
    }
  }
  return null;
}

export async function ingestListingRefs(
  options: ListingIngestOptions,
  fetcher: Fetcher,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
  refs: ListingRef[],
  limit: number,
  opts?: {
    /** One rotating HTTP fetcher per worker (Decodo session + port rotation). */
    useRotatingHttpWorkers?: boolean;
    sharedBrowserFetcher?: Fetcher;
    /** One Playwright fetcher per HTTP worker for WAF escalation (avoids shared-session cancel). */
    perWorkerBrowserFallback?: boolean;
    browserFallbackProxyHost?: string;
    /** `false` = visible Chromium windows for WAF fallback workers. */
    browserFallbackHeadless?: boolean;
  },
): Promise<ListingIngestRunStats> {
  const keyer = new BizBuySellDedupKeyer();
  let ordered = refs;
  if (options.ingestFailuresPath) {
    const failures = await readIngestFailuresCollection(
      options.ingestFailuresPath,
    );
    if (options.prioritizeIngestFailures === true) {
      // Retry mode: caller passes failed-only refs; do not merge with catalog ordering.
      ordered = refs;
      const hardBlocks = countNonRetriableIngestFailures(failures);
      if (hardBlocks > 0) {
        options.onProgress?.({
          phase: "fetch",
          message: `Retrying ${refs.length} failed listing(s) (${hardBlocks} prior Akamai hard block(s); use a fresh CLEARBOLT_PROXY_SESSION_ID and/or --headed)`,
        });
      }
    } else {
      ordered = orderListingRefsForIngest(refs, failures, {
        prioritizeFailures: false,
        adapter: BIZBUYSELL_ADAPTER_ID,
      });
      const deferred = countNonRetriableIngestFailures(failures);
      if (deferred > 0) {
        options.onProgress?.({
          phase: "fetch",
          message: `${deferred} Akamai hard-block failure(s) deferred (use --retry-failures-only after a fresh proxy session)`,
        });
      }
    }
  }
  const batch = ordered.slice(0, limit);
  const priorSatisfied = await countSatisfiedInRefList(
    options.listingIngestState,
    BIZBUYSELL_ADAPTER_ID,
    batch,
  );
  const useRotatingHttp =
    opts?.useRotatingHttpWorkers ??
    (options.useFixtures ? false : shouldPreferHttpIngestForBizBuySell());
  const proxyPorts = residentialProxyEndpointCount();
  const concurrency = resolveListingIngestConcurrency({
    explicit: options.concurrency,
    useRotatingHttpWorkers: useRotatingHttp,
  });
  const workerCount = Math.max(1, Math.min(concurrency, batch.length));
  const concurrencyCap = process.env.CLEARBOLT_SCRAPE_CONCURRENCY?.trim();
  const perWorkerBrowser =
    Boolean(opts?.perWorkerBrowserFallback) &&
    useRotatingHttp &&
    process.env.CLEARBOLT_SKIP_BROWSER !== "1";

  const browserPoolSize = perWorkerBrowser
    ? resolveBrowserFallbackWorkerCount(workerCount)
    : 0;
  const browserPool: Array<RotatingFetcherCloser | null> = Array.from(
    { length: browserPoolSize },
    () => null,
  );
  const browserPoolInit: Array<Promise<RotatingFetcherCloser | null> | null> =
    Array.from({ length: browserPoolSize }, () => null);
  let browserPoolWarned = false;

  const browserFetcherForWorker = async (
    workerIndex: number,
  ): Promise<Fetcher | undefined> => {
    if (browserPoolSize === 0) return undefined;
    const slot = workerIndex % browserPoolSize;
    if (!browserPoolInit[slot]) {
      const host = opts?.browserFallbackProxyHost ?? "www.bizbuysell.com";
      browserPoolInit[slot] = createRotatingBrowserFetcher({
        workerIndex: slot,
        proxyHostHint: host,
        headless: opts?.browserFallbackHeadless,
      }).then((w) => {
        browserPool[slot] = w;
        if (!w && !browserPoolWarned) {
          browserPoolWarned = true;
          console.warn(
            "[ingest] Playwright fallback failed to start — HTTP-only on WAF. " +
              "Run pnpm ensure:playwright or unset CLEARBOLT_SKIP_BROWSER=1.",
          );
        }
        return w;
      });
    }
    const init = browserPoolInit[slot];
    if (!init) return undefined;
    const w = await init;
    return w ?? undefined;
  };

  const sharedBrowserLane =
    !perWorkerBrowser && wafPolicy.browserFetcher
      ? concurrency > 1
        ? serializedFetcher(wafPolicy.browserFetcher)
        : wafPolicy.browserFetcher
      : undefined;

  const sharedBrowser =
    !useRotatingHttp && opts?.sharedBrowserFetcher
      ? opts.sharedBrowserFetcher
      : undefined;
  const sessionMins = Math.max(
    1,
    Math.round(proxySessionRotateWindowMs() / 60_000),
  );
  const proxyNote = useRotatingHttp
    ? proxyPorts > 0
      ? `, ${concurrency}/${proxyPorts} proxy port(s)${concurrencyCap ? ` (CLEARBOLT_SCRAPE_CONCURRENCY=${concurrencyCap})` : ""}, ~${sessionMins}m session rotation`
      : `, ${concurrency} HTTP worker(s), ~${sessionMins}m session rotation`
    : proxyPorts > 1
      ? `, ${concurrency} parallel`
      : "";
  const browserNote =
    browserPoolSize > 0
      ? `, ≤${browserPoolSize} Playwright fallback (lazy)`
      : "";
  const fetchProgressPrefix =
    priorSatisfied > 0
      ? `${priorSatisfied} / ${batch.length} already satisfied — fetching `
      : "Fetching ";
  options.onProgress?.({
    phase: "fetch",
    message: `${fetchProgressPrefix}${batch.length} listings (${workerCount} parallel${proxyNote}${browserNote})…`,
    total: batch.length,
    current: priorSatisfied,
  });

  const rotatingWorkers: RotatingFetcherCloser[] = useRotatingHttp
    ? Array.from({ length: workerCount }, (_, i) =>
        createRotatingHttpFetcher(i),
      )
    : [];

  let ingested = 0;
  let skippedFresh = 0;
  let skippedKnown = 0;
  let failed = 0;
  /** Refs touched this run (skip, ingest, or fail). */
  let scannedThisRun = 0;
  let lastReportedSatisfied = -1;
  let lastReportedScanned = -1;
  const failures = new IngestFailureCollector();
  const failureLogPath = process.env.CLEARBOLT_SCRAPE_FAILURE_LOG?.trim();
  let consecutiveFailures = 0;
  let proxyExhaustionHintShown = false;

  const ingestProgressSkipLogEvery = (): number => {
    const raw = process.env.CLEARBOLT_INGEST_PROGRESS_SKIP_EVERY?.trim();
    if (raw === "0") return 0;
    if (raw !== undefined && raw !== "") {
      const n = Number.parseInt(raw, 10);
      if (!Number.isNaN(n) && n > 0) return n;
    }
    return 100;
  };
  const skipLogEvery = ingestProgressSkipLogEvery();

  const reportIngestProgress = (force = false): void => {
    const satisfied = priorSatisfied + ingested;
    const scanned = priorSatisfied + scannedThisRun;
    if (
      !force &&
      satisfied === lastReportedSatisfied &&
      scanned === lastReportedScanned
    ) {
      return;
    }
    if (
      !force &&
      skipLogEvery > 0 &&
      scanned % skipLogEvery !== 0 &&
      scanned < batch.length
    ) {
      return;
    }
    lastReportedSatisfied = satisfied;
    lastReportedScanned = scanned;
    const parts: string[] = [];
    if (ingested > 0) parts.push(`${ingested} new`);
    if (skippedKnown > 0) parts.push(`${skippedKnown} skipped`);
    if (skippedFresh > 0) parts.push(`${skippedFresh} fresh-skip`);
    if (failed > 0) parts.push(`${failed} failed`);
    const suffix = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
    const scanNote = scanned > satisfied ? `, ${scanned} refs scanned` : "";
    options.onProgress?.({
      phase: "ingest",
      message: `${satisfied} / ${batch.length} satisfied${scanNote}${suffix}`,
      current: satisfied,
      total: batch.length,
    });
  };

  if (priorSatisfied > 0) {
    reportIngestProgress(true);
  }

  const markHandled = (
    outcome: IngestOneListingResult | "failed",
    forceProgress = false,
  ): void => {
    if (outcome === "ingested") ingested++;
    else if (outcome === "skipped_known") skippedKnown++;
    else if (outcome === "skipped_fresh") skippedFresh++;
    else failed++;
    scannedThisRun++;
    reportIngestProgress(forceProgress);
  };

  try {
    await mapConcurrent(batch, workerCount, async (ref, _i, workerIndex) => {
      const rotating = rotatingWorkers[workerIndex];
      const workerFetcher = useRotatingHttp
        ? (rotating ?? fetcher)
        : (sharedBrowser ?? fetcher);
      const browserForWorker = perWorkerBrowser
        ? await browserFetcherForWorker(workerIndex)
        : sharedBrowserLane;
      const workerWaf: FetchHtmlWithHttpWafPolicyOptions = {
        ...wafPolicy,
        browserFetcher: browserForWorker,
      };
      try {
        const outcome = await ingestOneListing(
          options,
          workerFetcher,
          workerWaf,
          ref,
          keyer,
        );
        markHandled(outcome, outcome === "ingested");
        consecutiveFailures = 0;
        return outcome === "ingested";
      } catch (err) {
        let lastErr: unknown = err;
        const hardBlock =
          lastErr instanceof Error &&
          isNonRetriableIngestFailureMessage(lastErr.message);
        if (hardBlock && useRotatingHttp) {
          const proxyRetries = akamaiHardBlockProxyRetryAttempts();
          for (let retry = 0; retry < proxyRetries; retry++) {
            rotatingWorkers[workerIndex]?.rotateSession();
            if (process.env.CLEARBOLT_PROXY_ROTATION_LOG === "1") {
              console.log(
                `[ingest] Akamai hard block for ${ref.externalId ?? ref.url}; ` +
                  `rotating proxy and retrying (${retry + 1}/${proxyRetries})`,
              );
            }
            try {
              const outcome = await ingestOneListing(
                options,
                workerFetcher,
                workerWaf,
                ref,
                keyer,
              );
              markHandled(outcome, outcome === "ingested");
              consecutiveFailures = 0;
              return outcome === "ingested";
            } catch (retryErr) {
              lastErr = retryErr;
              if (
                !(
                  retryErr instanceof Error &&
                  isNonRetriableIngestFailureMessage(retryErr.message)
                )
              ) {
                break;
              }
            }
          }
        }
        failures.logFailure(ref, lastErr);
        const failId = externalIdFromListingRef(ref);
        const failureTrace = failureTraceFromError(lastErr);
        if (options.listingIngestState && failId) {
          await persistListingIngestState(options.listingIngestState, {
            adapter: BIZBUYSELL_ADAPTER_ID,
            externalId: failId,
            url: ref.url,
            status: "failed",
            failure: failureTrace,
          }).catch(() => undefined);
        }
        if (options.ingestFailuresPath) {
          await recordIngestFailure(
            options.ingestFailuresPath,
            ref,
            BIZBUYSELL_ADAPTER_ID,
            lastErr,
            failureTrace,
          ).catch(() => undefined);
        }
        const failedHard =
          lastErr instanceof Error &&
          isNonRetriableIngestFailureMessage(lastErr.message);
        if (!failedHard) consecutiveFailures++;
        if (!proxyExhaustionHintShown && consecutiveFailures >= 8) {
          proxyExhaustionHintShown = true;
          console.error(
            "[ingest] Many consecutive retriable failures — try lower concurrency " +
              "(CLEARBOLT_SCRAPE_CONCURRENCY=8), longer sticky sessions " +
              "(CLEARBOLT_PROXY_SESSION_DURATION_MINUTES=1440), or a new CLEARBOLT_PROXY_SESSION_ID per run.",
          );
        }
        markHandled("failed", true);
        return false;
      }
    });
  } finally {
    await Promise.all([
      ...rotatingWorkers.map((w) => w.close()),
      ...browserPool.map((w) => w?.close()),
    ]);
  }

  reportIngestProgress(true);
  failures.printSummary();
  if (failureLogPath && failures.count > 0) {
    await failures.appendJsonl(failureLogPath);
  }

  return {
    listingsIngested: ingested,
    listingsFailed: failed,
    listingsSkippedKnown: skippedKnown,
    listingsSkippedFresh: skippedFresh,
  };
}

export function withCanonicalTracking<
  T extends ListingIngestOptions & {
    onIngested?: RunBizBuySellScrapeOptions["onIngested"];
  },
>(options: T, canonicalIds: string[]): T {
  const prior = options.onIngested;
  return {
    ...options,
    onIngested: (args) => {
      if (!canonicalIds.includes(args.result.canonicalId)) {
        canonicalIds.push(args.result.canonicalId);
      }
      prior?.(args);
    },
  };
}

export async function runBizBuySellScrape(
  options: RunBizBuySellScrapeOptions,
): Promise<RunBizBuySellScrapeResult> {
  const searchUrlArg = options.searchUrl.trim();
  parseSearchUrl(searchUrlArg);

  const canonicalIds: string[] = [];
  const run = withCanonicalTracking(options, canonicalIds);

  const limit = options.limit ?? 10;
  const baseDiscoveryMode = resolveBizBuySellDiscoveryMode({
    useFixtures: options.useFixtures,
    discovery: options.discovery,
  });
  const keywords =
    options.searchKeywords?.trim() || keywordsFromSearchUrl(searchUrlArg) || "";

  primeBizBuySellResidentialHosts();
  const browserFirst =
    Boolean(options.browserFetcher) && shouldUseBrowserFirstForBizBuySell();

  let fetcher: Fetcher;
  let effectiveSearch: string;
  if (baseDiscoveryMode === "fixtures") {
    const bundle = await buildBizBuySellFixtureFetcher();
    fetcher = bundle.fetcher;
    effectiveSearch = bundle.fixtureSearchUrl;
  } else if (browserFirst && options.browserFetcher) {
    fetcher = options.browserFetcher;
    effectiveSearch = searchUrlArg;
  } else {
    fetcher = new HttpFetcher({ sessionKey: proxySessionKeyFromEnv() });
    effectiveSearch = searchUrlArg;
  }

  const persistNeedsBrowser: FetchHtmlWithHttpWafPolicyOptions["persistNeedsBrowser"] =
    async (host) => {
      await options.metadata.putDomainProfile({
        host,
        needsBrowser: true,
        lastUpdatedAt: new Date().toISOString(),
      });
    };
  const hostRequiresBrowser: FetchHtmlWithHttpWafPolicyOptions["hostRequiresBrowser"] =
    async (host) => {
      const p = await options.metadata.getDomainProfile(host);
      return p?.needsBrowser === true;
    };
  const wafPolicy = {
    persistNeedsBrowser,
    hostRequiresBrowser,
    browserFetcher: options.browserFetcher,
    browserLanePrimary: browserFirst,
    proxySessionKey: proxySessionKeyFromEnv(),
    maxHttpAttempts: 4,
    throttleMsBetweenRetries: 3000,
  };

  if (baseDiscoveryMode === "serper") {
    options.onProgress?.({
      phase: "discovery",
      message: "Discovering listing URLs via Serper…",
    });
    const { refs, serperQuery, raw } =
      await discoverBizBuySellListingRefsFromSerper(keywords, limit);
    const serperBuf = Buffer.from(JSON.stringify(raw), "utf8");
    const searchRef = await options.evidence.put(serperBuf, {
      adapter: BIZBUYSELL_ADAPTER_ID,
      contentType: "application/json",
      sourceUrl: `serper:${serperQuery}`,
    });
    const ingestStats = await ingestListingRefs(
      run,
      fetcher,
      listingIngestWafPolicy(wafPolicy),
      refs,
      limit,
    );
    return {
      ...ingestStats,
      searchEvidenceKey: searchRef.key,
      effectiveSearchUrl: serperQuery,
      discoveryMode: "serper",
      canonicalIds,
    };
  }

  options.onProgress?.({
    phase: "discovery",
    message: browserFirst
      ? "Loading BizBuySell search page (Playwright + proxy)…"
      : shouldUseHttpProxyFirstForBizBuySell()
        ? "Loading BizBuySell search page (HTTP + proxy)…"
        : "Loading BizBuySell search page…",
  });
  const searchRes = await fetchHtmlWithHttpWafPolicy(
    fetcher,
    effectiveSearch,
    wafPolicy,
  );
  const discoverBase = searchRes.finalUrl || effectiveSearch;
  const searchBuf = Buffer.from(searchRes.body, "utf8");
  const searchRef = await options.evidence.put(searchBuf, {
    adapter: BIZBUYSELL_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: discoverBase,
  });

  let refs: ListingRef[] = [];
  for await (const ref of discoverListingRefs(searchRes.body, discoverBase)) {
    refs.push(ref);
    if (refs.length >= limit) break;
  }

  let serperSupplement = 0;
  if (serperSupplementEnabled()) {
    options.onProgress?.({
      phase: "discovery",
      message: "Supplementing with Serper listing URLs…",
    });
    const merged = await supplementListingRefsFromSerper(refs, keywords, limit);
    refs = merged.refs;
    serperSupplement = merged.serperAdded;
  }

  const discoveryMode: BizBuySellDiscoveryMode =
    serperSupplement > 0 ? "direct+serper" : "direct";

  const ingestStats = await ingestListingRefs(
    run,
    fetcher,
    listingIngestWafPolicy(wafPolicy),
    refs,
    limit,
  );

  return {
    ...ingestStats,
    searchEvidenceKey: searchRef.key,
    effectiveSearchUrl: discoverBase,
    discoveryMode,
    canonicalIds,
    serperSupplement,
  };
}
