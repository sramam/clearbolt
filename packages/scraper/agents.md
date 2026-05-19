# `packages/scraper`

> Runtime: **node** (Fly.io). Cloudflare Workers port is possible later for the HTTP-only path but not pursued — Playwright + native binaries + AIA TLS work require Node, and the cost tradeoff vs Browser Rendering does not justify it at our volume.

The scraper is the production embodiment of hard-won lessons from a prior Akamai-heavy scraping project. The architecture is **HTTP-first, browser when needed**, with TLS / AIA fixed at the Node level, per-domain AIMD throttling, WAF heuristics that escalate intelligently rather than retry forever, and a `needsBrowser` persistence layer that remembers hard hosts across restarts.

This document encapsulates that wisdom so future contributors do not relearn it.

## Architecture: HTTP-first, browser when needed

The old single-lane Crawlee-only flow is replaced by a `CrawlEngine` that runs **two lanes**:

- **High-concurrency HTTP** (`got`) for cheap fetches when they succeed.
- **Playwright** only when HTTP is not enough, or when the page is wrong for HTTP (SPA, Akamai challenge, etc.).

This matters for Akamai because bare Node HTTP often gets 401/403 challenge pages, while a real browser session can complete the challenge or serve full HTML.

```mermaid
flowchart LR
    Job[Fetcher.fetch request] --> Decide{needsBrowser?}
    Decide -->|"no"| HttpLane[HTTP lane: got + AIA + AIMD + headers]
    Decide -->|"yes"| BrowserLane[Browser lane: Playwright + AIMD]
    HttpLane --> Classify1{Classify}
    BrowserLane --> Classify2{Classify}
    Classify1 -->|"ok"| Result1[RawResponse]
    Classify1 -->|"WAF / challenge / 4xx"| Escalate[Mark needsBrowser; escalate to browser]
    Escalate --> BrowserLane
    Classify1 -->|"TLS UNABLE_TO_VERIFY"| AIA[AIA fetch intermediate; rebuild agent; retry]
    AIA --> HttpLane
    Classify2 -->|"ok"| Result2[RawResponse]
    Classify2 -->|"thin HTML / 4xx"| Backoff[Backoff + proxy rotate or fail]
```

## TLS / certificate chain (AIA)

`packages/scraper/src/tls-aia.ts` is a per-host `https.Agent` factory with AIA-fetched intermediate certificates (parsed with `node-forge`).

When a server sends an incomplete certificate chain (missing intermediate), Node.js's TLS layer rejects it with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Browsers handle this via AIA (Authority Information Access) — they read the CA Issuers URL from the leaf cert, download the intermediate, and build the full chain automatically.

`HttpFetcher` uses native `node:https` and, on that TLS failure, retries with an agent built as follows:

1. Connect with `rejectUnauthorized: false` to read the leaf cert.
2. Parse the AIA "CA Issuers" URL from the cert extensions.
3. Download the intermediate cert (typically DER over HTTP).
4. Build an `https.Agent` with `tls.rootCertificates` + the intermediate PEM.
5. Cache the agent per host:port for reuse.

Many large CDNs serve incomplete chains; browsers hide it, Node does not. AIA fixes the HTTP HTML pipeline so those calls verify TLS like a browser. On TLS failure that AIA cannot fix, HTTP handling falls back to the browser lane when Playwright is available.

## WAF / Akamai-style blocks

- **HTTP path**: 401/403 -> treat as WAF/auth -> escalate to Playwright (not endless retries on bare `https`).
- **Browser path**: same statuses trigger extra wait and a minimum HTML size check (`wafMinHtmlChars` / `wafExtraWaitMs`). If the body stays tiny, treat as blocked and error so retry/proxy-rotation logic can kick in.

The `WafDetector` contract classifies responses into `ok | challenge | block | rate_limited` and emits escalation hints. V0 ships heuristic rule packs covering Akamai, Cloudflare, PerimeterX. New WAF families add as plugin rule packs.

## Behavior under load: per-domain AIMD throttling

`DomainThrottleManager` adds adaptive per-domain limits:

- Slow start.
- Backoff on errors / 429 / `Retry-After` / `crawl-delay`.
- Separate pools for HTTP and browser (a domain can be aggressive on HTTP and gentle on browser, or vice versa).

This reduces the "burst of identical clients" pattern that often trips bot managers. State is persisted in `MetadataStore` so AIMD memory survives restarts.

## Remembering hard hosts: `needsBrowser`

Domains that once required a browser get `needsBrowser: true` in `MetadataStore.DomainProfile`. After restart, those hosts are routed toward the browser lane to avoid wasting cycles on HTTP-only attempts that we already know will fail.

`needsBrowser` is set:

- Automatically when WAF detection escalates HTTP -> browser successfully on a domain N times in a row.
- Manually by an operator (`pnpm clearbolt domain mark <host> --browser`).

`needsBrowser` is unset:

- Manually after a domain stops blocking (operator command).
- Periodically auto-tested by a low-priority HTTP probe — if N successes, downgrade.

## Other pieces

- **Browser-like request headers** on HTTP fetches (`Sec-Fetch-*`, `Accept`, `Accept-Language`, `User-Agent`, etc.) so we look less like a minimal scraper client.
- **SPA detection on HTTP**: very little text + framework markers (Next.js / React / Angular hydration scripts) -> escalate to browser.
- **CDN asset domains**: Akamai host suffixes, Cloudfront, etc. are treated as assets, not crawl targets, and routed away from the listing pipeline.

Together: fix Node TLS like a browser (AIA), try fast HTTP first with realistic headers, throttle per domain, persist "browser-only" domains, and use Playwright + WAF heuristics when the edge returns 401/403 or thin challenge HTML.

## Contracts

The scraper exposes these contracts (full inventory in [`docs/architecture/contracts.md`](../../docs/architecture/contracts.md)):

- `Fetcher` — `HttpFetcher`, `BrowserFetcher`, `MockFetcher`, optional `ApifyFetcher` ([adapters/bizbuysell/apify.md](adapters/bizbuysell/apify.md), [ADR 0013](../../docs/decisions/0013-apify-as-optional-fallback.md)).
- `ThrottleManager` — per-domain AIMD with persisted state.
- `WafDetector` — heuristic rule packs.
- `ProxyPool` — V0 direct only; V1+ residential / datacenter providers via env config.
- `Adapter` — per-source: `parseSearchUrl`, `discoverListingRefs`, `fetchListingDetail`, `extractBrokerLinks`.

## Adapters

One per site, in `packages/scraper/adapters/<source>/`:

- [bizbuysell](adapters/bizbuysell/agents.md) — primary, V0 (search + state catalog via `clearbolt catalog`; catalog pagination and listing-id discovery dedupe documented there).
- [bizquest](adapters/bizquest/agents.md) — V1.
- [businessbroker](adapters/businessbroker/agents.md) — V1.
- [businessesforsale](adapters/businessesforsale/agents.md) — pre-V1 catalog discovery (`/us/search/…`, Playwright); V1 listing parse + ingest.
- [loopnet](adapters/loopnet/agents.md) — pre-V1 catalog discovery (`/biz/…`); V1+ listing parse + business/property fields.
- [bizben](adapters/bizben/agents.md) — V1+ (CA-heavy).
- [dealstream](adapters/dealstream/agents.md) — V1+.

Adapters do not branch on lane (HTTP vs browser). Both lanes feed the same `RawSourceRecord` shape; lane selection is `Fetcher`-level.

## HTTP scraper service

[`apps/scraper-service`](../../apps/scraper-service/agents.md) exposes `POST /v1/bizbuysell/scrape` and `POST /v1/bizbuysell/catalog-scrape` as NDJSON streams (progress + result). The web app and operators use this instead of spawning Playwright inside Next.js when `CLEARBOLT_SCRAPER_SERVICE_URL` is set.

## Discovery, proxies, resume state

- **Serper** — optional Google SERP discovery (`serper-client.ts`, `bizbuysell-serper-discovery.ts`) when `SERP_DEV_API_KEY` / `SERPER_API_KEY` is set; web/CLI `discovery: "serper"`.
- **Rotating proxy** — `rotating-proxy-fetcher.ts`, `proxy-config.ts`, `proxy-endpoints-file.ts`; tiers `direct-then-residential` etc. (see `.env.example`).
- **Scrape-run layout (ADR [0017](../../docs/decisions/0017-scrape-run-filesystem-layout.md))** — `scrapes/{listings|brokers}/<domain>/<scrape-id>/` with `scrape.json` (cumulative + `nextRunId`), `runs/<run-id>/run.json`, per-listing `listings/<id>/index.json` + `runs/<run-id>/manifest.json` (pointers to content-addressed blobs). Helpers: `scrape-paths.ts`. Migration: `pnpm migrate:scrape-layout` after `mv data data1 && mkdir data`.
- **Tiered freshness ([ingestion-freshness.md](../../docs/architecture/ingestion-freshness.md))** — daily catalog discovery; weekly detail by default; daily detail for dealbox / new ids; `cardFingerprint` + `lastBodyFingerprint` to skip redundant fetches. V0 env: `CLEARBOLT_LISTING_FETCH_COOLDOWN_*`; scheduler tests TBD (`listing-fetch-schedule.test.ts`).
- **Legacy (pre-0017, dual-read during cutover)** — `catalog-refs/…`, `listing-ingest-state/<adapter>/<id>/state.json`, `ingest-failures/<adapter>.json`.
- **Evidence / processed** — `raw/<adapter>/<sha256>.<ext>`, `processed/<adapter>/…` (unchanged; manifests reference keys).
- **Listing resume** — prefer `listings/<id>/index.json` under the active scrape; falls back to legacy `listing-ingest-state` until migration completes. Pairs with dedup [`listing-fetch-cooldown`](../dedup/agents.md).
- **Robots** — `robots-policy.ts` + `CLEARBOLT_SCRAPER_ROBOTS` / min gap env vars.
- **Processed artifacts** — markdown, structured JSON, optional embedding JSON under evidence store paths (see `.env.example` R2 layout).

## Where it runs

**Fly.io.** Two reasons:

1. Playwright + ffmpeg + native binaries do not run on CF Workers.
2. AIA TLS handling, AIMD persistence, long-running browser sessions all want a long-lived Node process; Workers' per-request CPU model fights this.

A future CF Worker port is possible for the **HTTP-only** lane on cooperative sites, but Cost Browser Rendering at our volume is not better than Fly Playwright. Tracked in [`docs/decisions/open.md`](../../docs/decisions/open.md).

## V0 walking skeleton (this package's slice)

- `HttpFetcher` — Node `https` + **AIA** (`tls-aia.ts`, `node-forge` for Authority Information Access) with per-host agent cache; HTTP URLs still use `fetch`. `MockFetcher` (tests).
- `ThrottleManager` (in-process AIMD, in-memory state — persistence to `MetadataStore` lands when MetadataStore lands).
- `WafDetector` with Akamai rule pack (since BizBuySell uses Akamai, this exercises the wisdom up front).
- `crawl-policy.ts` + `fetch-with-waf-policy.ts` — bounded HTTP retries after `classifyWaf`; when the HTTP lane is exhausted, persist `needsBrowser` then optionally continue on the Playwright-backed `browserFetcher` (wired in the CLI scrape path with `openBrowserSession`).
- `BrowserFetcher` — Chromium via Playwright (`openBrowserSession`): one process per CLI scrape, shared across search + listing fetches when HTTP is skipped or exhausted; disabled with `CLEARBOLT_SKIP_BROWSER=1` or `--fixtures`. After `pnpm install`, run **`pnpm ensure:playwright`** from the repo root once per machine/image to download Chromium (see root README).
- **BizBuySell fixture replay:** checked-in HTML under `tests/fixtures/` for CI. Optional **`bizbuysell-live-cache.json`** holds a live-captured search page plus listing bodies keyed by real URLs; `pnpm fixtures:refresh` writes it (`BIZBUYSELL_FIXTURE_MASK_HTML=1` applies `maskBizBuySellHtml` for committed snapshots). `parseBizBuySellLiveCache` treats missing `fetchedAt` as a stable placeholder. **`validateBizBuySellLiveCacheInvariants`** checks structure and discoverability but not capture time; **`serializeBizBuySellLiveCacheForCompare`** omits `fetchedAt` and diffs masked HTML for golden tests. **`pnpm fixtures:recover`** truncates dev Neon metadata (guarded) then refreshes the cache — suggested when scraper fixture tests fail (Vitest prints a hint).
- One adapter end-to-end: `adapters/bizbuysell/` (including catalog walk — see [bizbuysell/agents.md](adapters/bizbuysell/agents.md#state-catalog-discovery-cli-clearbolt-catalog)).
- **Fly service:** [`apps/scraper-service`](../../apps/scraper-service/agents.md) for remote scrape/catalog from the web app.

## Validation criteria

### Contracts
- **Given** `hostRequiresBrowser` is true and no `browserFetcher`, **when** `fetchHtmlWithHttpWafPolicy` runs, **then** it throws before any HTTP `Fetcher.fetch` and does not call `persistNeedsBrowser`. Coverage: integration. Test: `packages/scraper/tests/fetch-waf-policy.test.ts::throws_when_host_requires_browser_but_no_browser_fetcher`.
- **Given** `hostRequiresBrowser` is true with a `browserFetcher`, **when** `fetchHtmlWithHttpWafPolicy` runs, **then** the HTTP fetcher is never used and the browser response is returned. Coverage: integration. Test: `packages/scraper/tests/fetch-waf-policy.test.ts::uses_browser_when_host_requires_browser_without_http_fetch`.
- **Given** a `Fetcher` that returns 429 twice then 200 for the same URL, **when** `fetchHtmlWithHttpWafPolicy` runs with default `maxHttpAttempts`, **then** the third response is returned and `persistNeedsBrowser` is never called. Coverage: integration. Test: `packages/scraper/tests/fetch-waf-policy.test.ts::retries_rate_limit_then_succeeds`.
- **Given** a `Fetcher` that returns only 429 for the same URL and no `browserFetcher`, **when** `fetchHtmlWithHttpWafPolicy` exhausts HTTP retries, **then** `persistNeedsBrowser` is invoked once for that host and the function throws. Coverage: integration. Test: `packages/scraper/tests/fetch-waf-policy.test.ts::throws_after_max_rate_limited_when_no_browser_fetcher`.
- **Given** HTTP WAF exhaustion with a `browserFetcher`, **when** `fetchHtmlWithHttpWafPolicy` runs, **then** `persistNeedsBrowser` is invoked once and the returned body comes from the browser fetcher. Coverage: integration. Test: `packages/scraper/tests/fetch-waf-policy.test.ts::persists_needs_browser_after_max_rate_limited_attempts_then_browser`.
- **Given** `CLEARBOLT_SKIP_BROWSER=1`, **when** `openBrowserSession` runs, **then** it returns null without importing Playwright. Coverage: integration. Test: `packages/scraper/tests/browser-fetcher.test.ts::returns_null_when_CLEARBOLT_SKIP_BROWSER`.
- **Given** HTTP returns 403 and a `browserFetcher`, **when** `fetchHtmlWithHttpWafPolicy` runs, **then** `persistNeedsBrowser` is invoked once and the returned body comes from the browser fetcher. Coverage: integration. Test: `packages/scraper/tests/fetch-waf-policy.test.ts::persists_on_challenge_then_browser_when_configured`.
- **Given** HTTP returns 403 and no `browserFetcher`, **when** `fetchHtmlWithHttpWafPolicy` runs, **then** `persistNeedsBrowser` is invoked once and the function throws. Coverage: integration. Test: `packages/scraper/tests/fetch-waf-policy.test.ts::persists_on_challenge_without_browser_still_throws`.
- **Given** any `Fetcher` backend, **when** the conformance suite runs, **then** all assertions pass (`Fetcher.fetch` returns a `RawResponse` with `status`, `body`, `finalUrl`, `headers`, `evidenceRef`). Coverage: integration. Test: `packages/scraper/src/conformance/fetcher.suite.ts` (TBD V0).
- **Given** a `WafDetector` classification and attempt count, **when** `planHttpLaneAfterWaf` runs, **then** challenge/block persist `needsBrowser` without endless HTTP retry, rate limits retry up to `maxHttpAttempts` then persist, and `ok` continues. Coverage: integration. Test: `packages/scraper/tests/engine-escalation.test.ts`.
- **Given** any `WafDetector`, **when** fed the fixture corpus in `packages/scraper/tests/fixtures/waf/*`, **then** classification matches the labeled expectation (`ok | challenge | block | rate_limited`). Coverage: golden-set. Test: `packages/scraper/tests/waf-detector.test.ts` (TBD V0).
- **Given** any `Adapter`, **when** the conformance suite runs, **then** `parseSearchUrl` round-trips, `discoverListingRefs` yields at least one ref on a fixture page, and `fetchListingDetail` produces a `RawSourceRecord` with provenance. Coverage: golden-set. Test: `packages/scraper/src/conformance/adapter.suite.ts` (TBD V0).
- **Given** two HTML fragments whose visible text is identical after tag stripping, **when** `htmlListingBodyFingerprint` runs on each, **then** the digests are equal. Coverage: unit. Test: `packages/scraper/tests/html-body-fingerprint.test.ts`.

### Functional
- **Given** an HTTPS host serving an incomplete certificate chain, **when** `HttpFetcher` connects, **then** AIA fetches the missing intermediate, builds an `https.Agent` with the full chain, caches it for the host, and the request succeeds. Coverage: integration. Test: `packages/scraper/tests/aia.test.ts::aia_completes_chain_for_incomplete_host`.
- **Given** a TLS leaf certificate with an Authority Information Access extension, **when** the CA Issuers URL is extracted, **then** it is a valid `http://` or `https://` URL. Coverage: integration. Test: `packages/scraper/tests/aia.test.ts::extracts_ca_issuers_url_from_incomplete_chain_leaf`.
- **Given** a domain that returns 401/403 to HTTP twice in a row, **when** the third attempt completes, **then** the domain's `DomainProfile.needsBrowser` is `true` and subsequent fetches route to the browser lane. Coverage: integration. Test: `packages/scraper/tests/needs-browser-promotion.test.ts` (TBD V0).
- **Given** a 429 with `Retry-After`, **when** received, **then** `DomainThrottleManager` waits at least the indicated interval before the next request to that domain. Coverage: integration. Test: `packages/scraper/tests/aimd-respects-retry-after.test.ts` (TBD V0).
- **Given** an HTTP response classified as SPA-skeleton (low text + framework markers), **when** received, **then** the request is escalated to the browser lane. Coverage: integration. Test: `packages/scraper/tests/spa-detection.test.ts` (TBD V0).
- **Given** any successful fetch, **when** complete, **then** the raw body is written to `EvidenceStore` and `RawSourceRecord.evidenceRef` references it. Coverage: integration. Test: `packages/scraper/tests/evidence-stored.test.ts` (TBD V0).

### Fixtures / drift
- **Given** a directory containing valid `bizbuysell-live-cache.json` with at least one listing entry, **when** `buildBizBuySellFixtureFetcher` runs, **then** the returned `MockFetcher` serves HTTP 200 for each cached `requestUrl` and `fixtureSearchUrl` matches the cache `searchUrl`. Coverage: unit. Test: `packages/scraper/tests/bizbuysell-fixture-fetcher.test.ts::buildBizBuySellFixtureFetcher uses live cache when listings are present`.
- **Given** malformed JSON or `version !== 1`, **when** `parseBizBuySellLiveCache` runs, **then** it returns `null`. Coverage: unit. Test: `packages/scraper/tests/bizbuysell-fixture-fetcher.test.ts::parseBizBuySellLiveCache rejects invalid payloads`.
- **Given** JSON with `version`/`searchUrl`/`searchHtml`/`listings` but no `fetchedAt`, **when** `parseBizBuySellLiveCache` runs, **then** it returns a cache with a fixed placeholder `fetchedAt`. Coverage: unit. Test: `packages/scraper/tests/bizbuysell-fixture-fetcher.test.ts::parseBizBuySellLiveCache defaults missing fetchedAt`.
- **Given** HTML that differs only by a `<script>` payload and two caches with different `fetchedAt`, **when** `serializeBizBuySellLiveCacheForCompare` runs on each, **then** the serialized strings are identical. Coverage: unit. Test: `packages/scraper/tests/bizbuysell-fixture-fetcher.test.ts::serializeBizBuySellLiveCacheForCompare ignores fetchedAt and scripts`.
- **Given** HTML containing `<script>`, **when** `maskBizBuySellHtml` runs, **then** script tags are removed from the result. Coverage: unit. Test: `packages/scraper/tests/bizbuysell-fixture-fetcher.test.ts::maskBizBuySellHtml removes script tags`.
- **Given** a minimal valid live cache, **when** `validateBizBuySellLiveCacheInvariants` runs, **then** it returns ok. Coverage: unit. Test: `packages/scraper/tests/bizbuysell-fixture-fetcher.test.ts::validateBizBuySellLiveCacheInvariants accepts minimal cache`.

### Drift / freshness
- **Given** any adapter with canary fixtures, **when** the daily canary fails twice consecutively, **then** the adapter is marked degraded and an alert fires. Coverage: smoke. Test: `services/adapter-canary/tests/two-strikes-degrade.test.ts` (TBD V1).

### Operational
- **Given** the scraper restarts, **when** it resumes, **then** AIMD state and `needsBrowser` are restored from `MetadataStore.DomainProfile`. Coverage: integration. Test: `packages/scraper/tests/state-survives-restart.test.ts` (TBD V0).
