# `packages/scraper/adapters/bizbuysell`

V0 primary adapter. BizBuySell is the broadest main-street marketplace and the best stress test for the scraper's HTTP-first + Playwright-fallback wisdom because it sits behind Akamai.

## Adapter API

- `parseSearchUrl(url) -> BizBuySellSavedSearchParams`
- `discoverListingRefs(params) -> AsyncIterable<ListingRef>`
- `fetchListingDetail(ref) -> RawSourceRecord`
- `extractBrokerLinks(record) -> BrokerEndpoint[]`

Implementation lives under `packages/scraper/src/adapters/bizbuysell/` (search/detail) and `packages/scraper/src/adapters/bizbuysell/catalog.ts` (state catalog). Shared listing URL helpers: `packages/scraper/src/bizbuysell-listing-url.ts`.

## State catalog discovery (CLI `clearbolt catalog`)

Regional catalogs use path pagination, not only `?page=`:

- Example: `https://www.bizbuysell.com/california-businesses-for-sale/`, then `/2/`, … until no next page or an empty listing page.
- **`walkCatalogPages`** (`packages/scraper/src/discovery/catalog-walk.ts`) fetches pages sequentially and merges refs.
- **`bizBuySellCatalogAdapter`** supplies pagination strategies (`rel-next`, query `page`, path increment), `discoverListingRefsFromCatalogPage` (JSON-LD + anchors), and `discoverNextBizBuySellCatalogPageUrl` (including synthesis when pager chrome has no usable `href`).
- **Discovery dedupe** uses `mergeListingRefByExternalId` — listing number (`externalId`) first, then URL. This is **in-memory only** for the catalog walk; it does **not** write to `MetadataStore`. Ingest still uses [`packages/dedup`](../../../dedup/agents.md) `ingestSourceRecord` + `BizBuySellDedupKeyer`.
- **Listing URLs** accepted for discovery/ingest: paths containing `business-opportunity`, `business-for-sale`, or `business-asset`, plus regional `/<slug>-business-for-sale/<id>/`. Excludes catalog slugs (`*-businesses-for-sale`) and non-listing paths (`business-broker`, `business-auction`, …). IDs are extracted via `extractBizBuySellListingIdFromPathname`.
- **Env:** `CLEARBOLT_CATALOG_MAX_PAGES` (default **0** = all pages until pagination stops), `CLEARBOLT_CATALOG_PAGE_GAP_MS`, `CLEARBOLT_BIZBUYSELL_BROWSER_FIRST`, residential proxy vars (see root `.env.example`). CLI: `--pages N` (omit or `0` for full walk), `--discover-only`, `--ingest N`.
- **Lanes:** with proxy + `CLEARBOLT_BIZBUYSELL_BROWSER_FIRST=1`, catalog discovery often uses Playwright on `m.bizbuysell.com`; HTTP catalog pagination stays on the HTTP lane when configured (`catalogDiscoveryWafPolicy`).

## Broker directory discovery

Regional **broker** catalogs (not listing catalogs) use the same `walkCatalogPages` machinery but discover `BrokerDirectoryRef`s:

- Example: `https://www.bizbuysell.com/business-brokers/california/`, paginated like state listing catalogs.
- Profile URLs: `/business-broker/{slug}/{id}/` (excluded from listing discovery — see `isBizBuySellListingUrl`).
- Parser: `packages/scraper/src/adapters/bizbuysell-broker-parse.ts` for profile pages (active + sold listing inventory).
- Akamai: same posture as listing catalogs; expect browser lane + `needsBrowser` on `www.bizbuysell.com`.

Broker directory refs feed [`packages/broker-directory`](../../../broker-directory/agents.md) `bbs-dir` sub-adapter and shared `Broker` materialization ([data-model.md](../../../../docs/architecture/data-model.md#broker-materialization-workflow)).

## Search URL shape (rough)

`https://www.bizbuysell.com/businesses-for-sale/?q=<keywords>&geo=<location>&prc=<min>-<max>...`

`parseSearchUrl` decodes these into `SavedSearchParams` (geo, industry, price range, cash flow, owner financing, listing type). `discoverListingRefs` paginates over results.

## Detail page extraction

- Title, headline, summary.
- Asking price, revenue, cash flow, EBITDA (when present).
- Location: state, city, county, MSA where derivable.
- Industry/category.
- Broker name, broker firm, listing ID.
- Optional: phone, email, broker profile URL.

Field-level provenance is recorded in the resulting `SourceRecord.parsedFields`.

## Anti-bot notes

- Akamai Bot Manager. Expect 401/403 on bare HTTP. The scraper's WAF detector escalates to browser; many requests succeed via Playwright.
- Per-domain `needsBrowser` likely set early — don't burn cycles re-trying HTTP.
- Browser-like headers on HTTP attempts still useful to maximize HTTP success rate when it does work.
- Keep concurrency low; the AIMD throttle handles this.

## Apify fallback option

If our in-house lane breaks for an extended period, `ApifyFetcher` can substitute. See [apify.md](apify.md) and [ADR 0013](../../../../docs/decisions/0013-apify-as-optional-fallback.md). Default: off.

## Tests

- Fixture HTML files for search, detail, broker pages.
- `parseSearchUrl` contract tests with sanitized real URLs.
- Canary fixtures against (sanitized) live pages on every parser change.

## Validation criteria

### Adapter contract (inherits the suite from `packages/scraper`)
- **Given** the BizBuySell adapter, **when** the `Adapter` conformance suite from `packages/scraper/src/conformance/adapter.suite.ts` runs, **then** all assertions pass: `parseSearchUrl` round-trip, `discoverListingRefs` yields ≥ 1 ref on a fixture page, `fetchListingDetail` produces a `RawSourceRecord` with provenance, `extractBrokerLinks` returns ≥ 0 typed `BrokerEndpoint`s. Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/conformance.test.ts` (TBD V0).

### Field extraction (golden-set on labeled fixtures)
- **Given** the labeled fixture corpus in `packages/scraper/adapters/bizbuysell/tests/fixtures/detail/*`, **when** parsed, **then** **per-field precision ≥ 95%** for `title`, `askingPrice`, `state`; **≥ 85%** for `revenue`, `cashFlow`, `ebitda`, `city`/`MSA`, `industry`, `brokerName`. Coverage: golden-set. Test: `packages/scraper/adapters/bizbuysell/tests/field-precision.test.ts` (TBD V0).
- **Given** any extracted field, **when** stored on `SourceRecord.parsedFields`, **then** field-level provenance (raw selector or text snippet) is recorded. Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/field-provenance.test.ts` (TBD V0).

### Anti-bot wisdom
- **Given** the BizBuySell domain, **when** the scraper boots fresh, **then** within N attempts `DomainProfile.needsBrowser` flips to `true` automatically (because Akamai blocks bare HTTP). Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/needs-browser-promotion.test.ts` (TBD V0). Falsifiability for the V0 wisdom claim — if this never triggers, our WAF detection is broken.
- **Given** the WAF detector on a 401/403 challenge page, **when** classifying, **then** it returns `challenge` (not `block`); the escalation routes to browser without proxy rotation. Coverage: golden-set. Test: `packages/scraper/adapters/bizbuysell/tests/waf-classification.test.ts` (TBD V0).

### Search URL round-trip
- **Given** any sanitized real BizBuySell search URL in the fixture corpus, **when** `parseSearchUrl(url)` → `serializeSearchUrl(params)`, **then** the regenerated URL produces the same first page of results (verified via fixture comparison). Coverage: golden-set. Test: `packages/scraper/adapters/bizbuysell/tests/search-url-roundtrip.test.ts` (TBD V0).

### Broker enrichment (marketplace)
- **Given** a labeled broker profile HTML fixture, **when** `parseBizBuySellBrokerProfilePage` runs, **then** `activeListings` contains ≥1 card with `url`, `externalId`, and optional `title`/`price`. Coverage: unit. Test: `packages/scraper/tests/bizbuysell-broker-parse.test.ts`.
- **Given** a listing detail fixture with broker contact fields, **when** `extractBrokerLinks` runs on the resulting `RawSourceRecord`, **then** it returns ≥1 `BrokerEndpoint` with `profileUrl` when the page links a broker profile. Coverage: unit. Test: `packages/scraper/adapters/bizbuysell/tests/extract-broker-links.test.ts` (TBD V1).
- **Given** a broker profile URL and N active listing refs from that profile, **when** those listings ingest and broker materialization runs, **then** one shared `Broker` row exists and N `BrokerListing` rows link the broker to the corresponding `CanonicalDeal`s. Coverage: integration. Test: `packages/storage-neon/tests/bizbuysell-broker-materialization.test.ts` (TBD V1).
- **Given** a broker directory catalog URL matching `/business-brokers/`, **when** broker-directory discovery runs, **then** each page yields `BrokerDirectoryRef` rows with `profileUrl` and `sourceAdapter: "bizbuysell"`. Coverage: unit. Test: `packages/scraper/tests/bizbuysell-broker-directory.test.ts` (TBD V1).

### Catalog discovery
- **Given** a catalog URL matching `*-businesses-for-sale`, **when** `isBizBuySellCatalogUrl` runs, **then** it returns true; generic search URLs without that suffix return false. Coverage: unit. Test: `packages/scraper/tests/bizbuysell-catalog.test.ts::recognizes california catalog URL`.
- **Given** fixture HTML with path pagination links, **when** `discoverNextBizBuySellCatalogPageUrl` runs from page 1, **then** the next URL is page 2 (including synthesis when `bbsPager_next` has no `href`). Coverage: unit. Test: `packages/scraper/tests/bizbuysell-catalog.test.ts` (pagination cases).
- **Given** two catalog fixture pages, **when** `discoverListingRefsFromCatalogPage` runs on each, **then** listing refs are merged by `externalId` across pages (unique listing count matches fixture IDs). Coverage: unit. Test: `packages/scraper/tests/bizbuysell-catalog.test.ts::discovers listings across paginated fixtures`.
- **Given** the same listing id on www and mobile URLs, **when** `mergeListingRefByExternalId` runs, **then** one ref remains and the preferred URL uses `www.bizbuysell.com`. Coverage: unit. Test: `packages/scraper/tests/discovery/listing-ref-merge.test.ts`.
- **Given** `business-broker` or `business-auction` paths with numeric segments, **when** `isBizBuySellListingUrl` runs, **then** it returns false. Coverage: unit. Test: `packages/scraper/tests/discovery/listing-ref-merge.test.ts::excludes broker and auction paths`.
- **Given** `maxPages: 0` in `walkCatalogPages`, **when** `discoverNext` returns null after the last page, **then** all pages up to that point are fetched. Coverage: unit. Test: `packages/scraper/tests/discovery/catalog-walk.test.ts::walks until no next page when maxPages is 0`.
- **Given** duplicate listing anchors for the same `externalId` across two catalog pages, **when** `walkCatalogPages` uses `mergeListingRefByExternalId`, **then** the merged ref list has length 1. Coverage: unit. Test: `packages/scraper/tests/discovery/catalog-walk.test.ts::dedupes the same listing across pages by external id`.

### Drift / freshness
- **Given** the BizBuySell canary fixtures, **when** the daily canary run completes, **then** zero parser-drift signals fire; if two consecutive canaries fail, the adapter is marked degraded and an alert fires. Coverage: smoke. Test: `services/adapter-canary/tests/bizbuysell.test.ts` (TBD V1).

### Apify fallback (optional)
- **Given** `ApifyFetcher` is enabled for this workspace × adapter, **when** the in-house lane is `degraded`, **then** Apify runs and produces records that pass the same `Adapter` conformance suite. Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/apify-fallback.test.ts` (TBD V1).

### Cross-link
- ADR (Apify): [`docs/decisions/0013-apify-as-optional-fallback.md`](../../../../docs/decisions/0013-apify-as-optional-fallback.md).
- Ingest dedupe + `contentUpdated`: [`packages/dedup/agents.md`](../../../dedup/agents.md).
- Scraper wisdom: [`packages/scraper/agents.md`](../../agents.md) validation criteria.
