# Ingestion architecture

Clearbolt has an **agentic ingestion system**, not just a scraper. Ingestion-system mechanics live here. Scraper-internal mechanics (HTTP-first lane, browser fallback, AIA, AIMD, WAF heuristics, `needsBrowser`) are encapsulated in [`packages/scraper/agents.md`](../../packages/scraper/agents.md).

## What ingestion does

1. Start from saved searches, imports, captures (universal clipper), or explicit URLs.
2. Discover source records.
3. Extract structured facts.
4. Follow useful links to broker pages or source websites when allowed.
5. Normalize records into common types.
6. Deduplicate and merge into canonical deals/businesses.
7. Surface changes, alerts, and confidence gaps to the searcher.
8. Hand off to the wiki maintainer agent so the per-deal wiki stays current.

## Adapter pattern

Each source type implements a narrow adapter interface. Adapters live in `packages/scraper/adapters/<source>/`.

Marketplace adapters support:

- `parseSearchUrl(url) -> SavedSearchParams`
- `discoverListingRefs(params) -> AsyncIterable<ListingRef>`
- `fetchListingDetail(ref) -> RawSourceRecord`
- `extractBrokerLinks(record) -> BrokerEndpoint[]`

Import adapters support:

- `parseImport(input) -> RawSourceRecord[]`
- `mapColumns(input) -> ImportMapping`
- `validateRows(input) -> ImportIssue[]`

Capture adapters (universal clipper, V1+):

- `parseCapture(rawHtml, url, hostHeuristic) -> RawSourceRecord | WorkspaceCapture`

Agents adding new sources prefer adapters over branching core pipeline logic.

## Catalog vs detail and tiered refresh

Discovery (catalog walk → listing ref set) and detail fetch (per-listing HTML → parse → dedup) are **separate phases** with different cadences. Default policy: **daily discovery**, **weekly detail** for the shared corpus, **daily detail** for dealbox listings. Fingerprints at catalog-card and body level avoid redundant HTTP. Full spec: [ingestion-freshness.md](ingestion-freshness.md). Layout: [ADR 0017](../decisions/0017-scrape-run-filesystem-layout.md).

## Source freshness, adapter SLAs, and parser drift

Adapters silently break. Plan for it.

Per adapter, track:

- **Freshness**: time since last successful run, last successful detail fetch, last new listing observed.
- **Success rate**: HTTP success, parse success, browser-fallback rate, error class breakdown.
- **Schema drift**: presence/shape of expected fields; alert when key fields disappear or shift.
- **Volume drift**: new-listing counts vs trailing baseline; alert on suspicious zeros or spikes.

Operational:

- **Canary fixtures**: a small set of real (sanitized) URLs run on every parser change; failures block release.
- **Adapter SLA badges**: surface freshness/health in the workspace UI per saved search ("BizBuySell: healthy, last update 14m ago" or "degraded — retrying").
- **Backoff / circuit-break**: when a domain returns Akamai challenges or 4xx/5xx beyond threshold, pause that adapter and notify operators rather than burn through proxies.

`TODO:` Define `AdapterHealth`, alert thresholds, and where adapter status appears in UI.

## Two ingestion lanes

The scraper exposes two execution lanes (HTTP fast path + browser fallback). Adapter authors should not branch on the lane — both lanes feed the same `RawSourceRecord` shape. Lane selection is a `Fetcher`-level decision based on per-domain history, response classification, and explicit `needsBrowser` markers.

Detailed mechanics in [`packages/scraper/agents.md`](../../packages/scraper/agents.md).

## Broker enrichment

Broker websites are important because they may contain richer or fresher deal data than marketplaces.

When marketplace records expose broker profile URLs, firm websites, listing IDs, phone numbers, or emails:

1. Extract and normalize broker/contact metadata.
2. Check whether the broker domain is safe and allowed to crawl.
3. Crawl only bounded listing pages, sitemaps, or relevant search pages.
4. Merge broker-native fields with field-level provenance.

`TODO:` Define crawl budgets, allow/block lists, and per-broker domain policies.

## External actors (Apify, etc.)

Apify and similar actors are kept as **optional fallback** `Fetcher` backends per [../decisions/0013-apify-as-optional-fallback.md](../decisions/0013-apify-as-optional-fallback.md). Useful when:

- The in-house lane is broken on a particular site and we need data now.
- Bootstrapping a new adapter where Apify already has reasonable parsers.

Treat them as replaceable integrations:

- Call actor/API from worker code through the `ApifyFetcher` backend.
- Map output into `RawSourceRecord`.
- Preserve source and actor metadata.
- Do not let third-party actor schemas become Clearbolt's internal domain model.

Default behavior: in-house `HttpFetcher`/`BrowserFetcher` lanes. Apify is opt-in per workspace per adapter.

## Validation criteria

### Functional
- **Given** a `SavedSearch` for adapter X, **when** the run job triggers, **then** the adapter's `parseSearchUrl → discoverListingRefs → fetchListingDetail → extractBrokerLinks` pipeline completes and produces at least one `RawSourceRecord`. Coverage: integration. Test: `packages/scraper/tests/adapter-end-to-end.test.ts::adapter_<x>` (TBD V1 per adapter; V0 for bizbuysell).
- **Given** an `Import` job (CSV, manual list), **when** the import adapter runs, **then** rows produce `RawSourceRecord`s and the dedup pipeline attaches them appropriately. Coverage: integration. Test: `packages/scraper/tests/import-adapter.test.ts` (TBD V1).
- **Given** a `Capture` from the universal clipper, **when** the capture adapter runs, **then** it produces a `WorkspaceCapture` row (workspace-scoped) AND optionally proposes attachment to a `CanonicalDeal` (shared). Coverage: integration. Test: `packages/scraper/tests/capture-adapter.test.ts` (TBD V1).

### Adapter health
- **Given** any adapter, **when** queried for health, **then** it returns `{ freshnessSecs, successRate24h, schemaDriftDetected, volume24h }`. Coverage: contract test. Test: `packages/scraper/tests/adapter-health-contract.test.ts` (TBD V1).
- **Given** an adapter whose `successRate24h` drops below 50%, **when** the health check runs, **then** the workspace UI surfaces an `AdapterDegraded` badge for any saved search using that adapter. Coverage: integration. Test: `apps/web/tests/adapter-degraded-surfaced.test.ts` (TBD V1).
- **Given** an adapter where a key field disappears for >10% of records, **when** schema drift detection runs, **then** an alert fires and the next deploy is blocked unless the canary fixture is updated. Coverage: integration. Test: `packages/scraper/tests/schema-drift-blocks-deploy.test.ts` (TBD V1.5).

### Backoff / circuit-break
- **Given** an adapter whose host returns Akamai challenges or 4xx/5xx beyond threshold, **when** the circuit breaker opens, **then** the adapter is paused and an operator alert fires (no proxy burn). Coverage: integration. Test: `packages/scraper/tests/circuit-breaker.test.ts` (TBD V1).

### Broker enrichment
- **Given** a broker website extracted from a `RawSourceRecord`, **when** the broker enrichment crawl runs, **then** the crawl respects per-domain budget (max N pages/24h) and per-broker allow/deny lists. Coverage: integration. Test: `packages/scraper/tests/broker-enrichment-budget.test.ts` (TBD V1).

### Apify fallback
- **Given** Apify is enabled for workspace X × adapter Y, **when** the adapter's in-house lane fails, **then** the run automatically falls over to Apify (per the toggle policy in [ADR 0013](../decisions/0013-apify-as-optional-fallback.md)). Coverage: integration. Test: `packages/scraper/tests/apify-fallback.test.ts` (TBD V1).
