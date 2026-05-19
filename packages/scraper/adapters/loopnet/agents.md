# `packages/scraper/adapters/loopnet`

Pre-V1: **catalog discovery** on `/biz/…` indexes. V1+: listing detail parse + business/property linkage + conformance suite.

Business + commercial real estate listings; useful when real estate is part of the thesis.

## Catalog discovery (CLI `clearbolt catalog --discover-only`)

Biz indexes use path pagination under `/biz/{geo}/`:

- Example: `https://www.loopnet.com/biz/california-businesses-for-sale/`, then `…/2/`, … until no next page or an empty listing page. Legacy two-segment URLs (`/biz/{geo}/businesses-for-sale/`) are also recognized. The current Angular `/biz/` SPA also emits a **double-slash** pager variant (`…/california-businesses-for-sale//2/`) — the adapter accepts it and canonicalizes to the single-slash form.
- Also supported: `/biz/{geo}/{category}-businesses` facet catalogs.
- **`loopNetCatalogAdapter`** (`packages/scraper/src/adapters/loopnet/catalog.ts`) discovers listing anchors from either URL grammar and merges by listing id:
  - **Current** (Angular `/biz/` SPA): `/biz/business-opportunity/{slug}/{id}/` and `/biz/business-for-sale/{slug}/{id}/`
  - **Legacy**: `/Listing/{slug}/{id}/`
- **Akamai:** plain HTTP returns 403; live discovery uses Playwright via `runLoopNetCatalogScrapeWithBrowser` (residential proxy recommended — see `.env.example`). Vanilla Playwright is detected at the CDP level (Akamai probes `Runtime.enable` / `--enable-automation`); when blocked, switch to `CLEARBOLT_BROWSER_DRIVER=patchright` after installing the optional dep (`pnpm add patchright -F @clearbolt/scraper && npx patchright install chrome`). Stealth mode runs persistent-context system Chrome with `viewport: null` and no custom UA/headers per the [patchright recipe](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs).
- Listing ingest is **not** implemented yet; use `--discover-only` and write refs to `<DATA_DIR>/catalog-refs/…`.

## Broker enrichment

LoopNet business listings may include broker contact on detail pages (V1+ parse). `extractBrokerLinks` feeds shared `Broker` materialization when profile or firm URLs are present.

## Special considerations (V1+ listing parse)

- Listings often combine business operations + property; the adapter should preserve both as separate fields and link them.
- Real-estate-only listings (no business attached) should be filtered or marked.

## Validation criteria

### Catalog discovery (pre-V1)
- **Given** a California catalog HTML fixture, **when** `discoverListingRefsFromLoopNetCatalogPage` runs, **then** it returns refs with numeric `externalId` and canonical `www` listing URLs. Coverage: unit. Test: `packages/scraper/tests/loopnet-catalog.test.ts`.
- **Given** catalog HTML with page-2 pager links, **when** `discoverNextLoopNetCatalogPageUrl` runs on page 1, **then** the next URL is page 2. Coverage: unit. Test: `packages/scraper/tests/loopnet-catalog.test.ts`.
- **Given** `clearbolt catalog <loopnet biz catalog url> --discover-only`, **when** the command completes, **then** it writes a catalog-refs JSON file with listing URLs (no listing ingest). Coverage: smoke. Test: manual / future CLI smoke.


### Broker enrichment (marketplace)
- **Given** a business listing detail fixture with broker fields, **when** `extractBrokerLinks` runs, **then** it returns ≥0 typed `BrokerEndpoint`s when the page links a broker or firm profile. Coverage: unit. Test: `packages/scraper/adapters/loopnet/tests/extract-broker-links.test.ts` (TBD V1.5).
- **Given** a listing ingest with `parsedFields.brokerName`, **when** broker materialization runs, **then** `BrokerListing` links broker to `CanonicalDeal`. Coverage: integration. Test: `packages/storage-neon/tests/loopnet-broker-materialization.test.ts` (TBD V1.5).

### Adapter contract
- **Given** the LoopNet adapter, **when** the `Adapter` conformance suite from `packages/scraper/src/conformance/adapter.suite.ts` runs, **then** all assertions pass. Coverage: integration. Test: `packages/scraper/adapters/loopnet/tests/conformance.test.ts` (TBD V1.5).

### Business + property linkage (the reason this adapter exists)
- **Given** any LoopNet listing that combines a business with real estate, **when** parsed, **then** `RawSourceRecord.parsedFields` carries both `businessFields` and `propertyFields` as separate sub-objects with a `linkedBy` reference. Coverage: integration. Test: `packages/scraper/adapters/loopnet/tests/business-property-linked.test.ts` (TBD V1.5). Falsifiability for the "preserve both as separate fields" claim.
- **Given** any real-estate-only LoopNet listing (no business attached), **when** parsed, **then** the record is marked `kind=real-estate-only` and is **not** ingested into the business-deal canonical graph. Coverage: integration. Test: `packages/scraper/adapters/loopnet/tests/re-only-filtered.test.ts` (TBD V1.5).

### Field extraction (golden-set)
- **Given** the labeled fixture corpus, **when** parsed, **then** **per-field precision ≥ 95%** for `title`, `askingPrice`, `state`; **≥ 85%** for `propertyType`, `squareFootage`, `city`/`MSA`, `industry` (when business attached). Coverage: golden-set. Test: `packages/scraper/adapters/loopnet/tests/field-precision.test.ts` (TBD V1.5).

### Search URL round-trip
- **Given** any sanitized real LoopNet search URL, **when** parsed and re-serialized, **then** the regenerated URL produces the same first page of results. Coverage: golden-set. Test: `packages/scraper/adapters/loopnet/tests/search-url-roundtrip.test.ts` (TBD V1.5).

### Drift / freshness
- **Given** LoopNet canary fixtures, **when** the daily canary completes, **then** zero parser-drift signals fire; two consecutive failures degrade the adapter. Coverage: smoke. Test: `services/adapter-canary/tests/loopnet.test.ts` (TBD V1.5).

### Cross-link
- Inherits scraper wisdom and operational guarantees from [`packages/scraper/agents.md`](../../agents.md).
