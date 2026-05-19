# `packages/scraper/adapters/businessesforsale`

National/international search, long-running global marketplace (`us.businessesforsale.com` is the US slice).

## Catalog discovery (pre-V1)

Regional / geo search indexes use **`/us/search/{slug}`** path pagination (`-2`, `-3`, … suffix on the slug segment). Example: `https://us.businessesforsale.com/us/search/california` → canonical slug `businesses-for-sale-in-california`.

- **`walkCatalogPages`** + **`businessesForSaleCatalogAdapter`** (`packages/scraper/src/adapters/businessesforsale/catalog.ts`).
- Listing refs from JSON-LD `Product.productId` + `/us/{slug}.aspx` anchors; merge by `externalId` during discovery.
- **Live fetch:** Cloudflare — Playwright required (`runBusinessesForSaleCatalogScrapeWithBrowser`). CLI: `clearbolt catalog <url> --discover-only`.
- **Listing ingest / field parse:** V1 (not wired in `clearbolt catalog` yet).

## Broker enrichment

Listing detail parse should populate `brokerName` and broker profile URL when present on the page. `extractBrokerLinks` returns `BrokerEndpoint[]` for materialization per [data-model.md](../../../../docs/architecture/data-model.md#broker-materialization-workflow).

## Validation criteria

### Catalog discovery (pre-V1)
- **Given** a URL matching `/us/search/{slug}` on `*.businessesforsale.com` without query string, **when** `isBusinessesForSaleCatalogUrl` runs, **then** it returns true; listing `.aspx` URLs return false. Coverage: unit. Test: `packages/scraper/tests/businessesforsale-catalog.test.ts::recognizes california catalog URL`.
- **Given** fixture HTML with JSON-LD `productId` and `rel=next`, **when** `discoverListingRefsFromBusinessesForSaleCatalogPage` / `discoverNextBusinessesForSaleCatalogPageUrl` run, **then** refs include numeric `externalId` and next page uses `-{n}` slug suffix. Coverage: unit. Test: `packages/scraper/tests/businessesforsale-catalog.test.ts` (parse + pagination cases).

### Broker enrichment (marketplace)
- **Given** a listing detail fixture with broker fields, **when** `extractBrokerLinks` runs, **then** it returns ≥0 `BrokerEndpoint`s with `profileUrl` when linked. Coverage: unit. Test: `packages/scraper/adapters/businessesforsale/tests/extract-broker-links.test.ts` (TBD V1).
- **Given** a listing `SourceRecord` with `parsedFields.brokerName`, **when** broker materialization runs after ingest, **then** `CanonicalDeal.brokerId` and `BrokerListing` are populated. Coverage: integration. Test: `packages/storage-neon/tests/businessesforsale-broker-materialization.test.ts` (TBD V1).

### Full adapter (V1)

### Adapter contract
- **Given** the BusinessesForSale adapter, **when** the `Adapter` conformance suite from `packages/scraper/src/conformance/adapter.suite.ts` runs, **then** all assertions pass. Coverage: integration. Test: `packages/scraper/adapters/businessesforsale/tests/conformance.test.ts` (TBD V1).

### Field extraction (golden-set)
- **Given** the labeled fixture corpus (mix of US and international slices), **when** parsed, **then** **per-field precision ≥ 95%** for `title`, `askingPrice`, `country`/`state`; **≥ 85%** for `revenue`, `cashFlow`, `city`, `industry`, `brokerName`. Coverage: golden-set. Test: `packages/scraper/adapters/businessesforsale/tests/field-precision.test.ts` (TBD V1).
- **Given** any non-USD asking price, **when** parsed, **then** currency is preserved (no silent USD coercion); normalization to USD happens downstream with `currencyOfRecord` provenance. Coverage: integration. Test: `packages/scraper/adapters/businessesforsale/tests/currency-preserved.test.ts` (TBD V1).

### Search URL round-trip
- **Given** any sanitized real businessesforsale.com search URL (US slice), **when** parsed and re-serialized, **then** the regenerated URL produces the same first page of results. Coverage: golden-set. Test: `packages/scraper/adapters/businessesforsale/tests/search-url-roundtrip.test.ts` (TBD V1).

### Drift / freshness
- **Given** businessesforsale.com canary fixtures, **when** the daily canary completes, **then** zero parser-drift signals fire; two consecutive failures degrade the adapter. Coverage: smoke. Test: `services/adapter-canary/tests/businessesforsale.test.ts` (TBD V1).

### Cross-link
- Inherits scraper wisdom and operational guarantees from [`packages/scraper/agents.md`](../../agents.md).
