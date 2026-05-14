# `packages/scraper/adapters/businessesforsale`

V1 adapter. National/international search, long-running global marketplace (us.businessesforsale.com is the US slice).

`TODO:` Fill in adapter API stubs, parser shape, anti-bot notes, and canary fixtures once V1 adapter work begins.

## Validation criteria

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
