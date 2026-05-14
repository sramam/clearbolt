# `packages/scraper/adapters/bizben`

V1+ adapter. California-heavy. Especially relevant for CA-based searchers; surfaces broker activity in Santa Clara, LA, San Diego, etc.

`TODO:` Fill in adapter API stubs, parser shape, anti-bot notes, and canary fixtures once V1+ adapter work begins.

## Validation criteria

### Adapter contract
- **Given** the BizBen adapter, **when** the `Adapter` conformance suite from `packages/scraper/src/conformance/adapter.suite.ts` runs, **then** all assertions pass. Coverage: integration. Test: `packages/scraper/adapters/bizben/tests/conformance.test.ts` (TBD V1.5).

### CA-heavy coverage (the reason this adapter exists)
- **Given** the labeled fixture corpus, **when** parsed, **then** **≥ 90% of records** have `state="CA"`; non-CA records (rare) are still parsed correctly. Coverage: golden-set. Test: `packages/scraper/adapters/bizben/tests/ca-coverage.test.ts` (TBD V1.5). Falsifiability for the "California-heavy" claim — if this fails, BizBen's value prop has shifted and the adapter's prioritization needs re-evaluation.

### Field extraction (golden-set)
- **Given** the labeled fixture corpus, **when** parsed, **then** **per-field precision ≥ 95%** for `title`, `askingPrice`, `state`; **≥ 85%** for `revenue`, `cashFlow`, `city` (CA cities — Santa Clara, LA, San Diego, etc.), `industry`, `brokerName`. Coverage: golden-set. Test: `packages/scraper/adapters/bizben/tests/field-precision.test.ts` (TBD V1.5).

### Search URL round-trip
- **Given** any sanitized real BizBen search URL, **when** parsed and re-serialized, **then** the regenerated URL produces the same first page of results. Coverage: golden-set. Test: `packages/scraper/adapters/bizben/tests/search-url-roundtrip.test.ts` (TBD V1.5).

### Drift / freshness
- **Given** BizBen canary fixtures, **when** the daily canary completes, **then** zero parser-drift signals fire; two consecutive failures degrade the adapter. Coverage: smoke. Test: `services/adapter-canary/tests/bizben.test.ts` (TBD V1.5).

### Cross-link
- Inherits scraper wisdom and operational guarantees from [`packages/scraper/agents.md`](../../agents.md).
