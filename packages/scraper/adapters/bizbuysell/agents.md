# `packages/scraper/adapters/bizbuysell`

V0 primary adapter. BizBuySell is the broadest main-street marketplace and the best stress test for the scraper's HTTP-first + Playwright-fallback wisdom because it sits behind Akamai.

## Adapter API

- `parseSearchUrl(url) -> BizBuySellSavedSearchParams`
- `discoverListingRefs(params) -> AsyncIterable<ListingRef>`
- `fetchListingDetail(ref) -> RawSourceRecord`
- `extractBrokerLinks(record) -> BrokerEndpoint[]`

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

### Drift / freshness
- **Given** the BizBuySell canary fixtures, **when** the daily canary run completes, **then** zero parser-drift signals fire; if two consecutive canaries fail, the adapter is marked degraded and an alert fires. Coverage: smoke. Test: `services/adapter-canary/tests/bizbuysell.test.ts` (TBD V1).

### Apify fallback (optional)
- **Given** `ApifyFetcher` is enabled for this workspace × adapter, **when** the in-house lane is `degraded`, **then** Apify runs and produces records that pass the same `Adapter` conformance suite. Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/apify-fallback.test.ts` (TBD V1).

### Cross-link
- ADR (Apify): [`docs/decisions/0013-apify-as-optional-fallback.md`](../../../../docs/decisions/0013-apify-as-optional-fallback.md).
- Scraper wisdom: [`packages/scraper/agents.md`](../../agents.md) validation criteria.
