# `packages/scraper/adapters/businessbroker`

V1 adapter. Broker-listed local deals; good for services, retail, restaurants, light industrial.

`TODO:` Fill in adapter API stubs, parser shape, anti-bot notes, and canary fixtures once V1 adapter work begins.

## Validation criteria

### Adapter contract
- **Given** the businessbroker.net adapter, **when** the `Adapter` conformance suite from `packages/scraper/src/conformance/adapter.suite.ts` runs, **then** all assertions pass. Coverage: integration. Test: `packages/scraper/adapters/businessbroker/tests/conformance.test.ts` (TBD V1).

### Field extraction (golden-set)
- **Given** the labeled fixture corpus, **when** parsed, **then** **per-field precision ≥ 95%** for `title`, `askingPrice`, `state`; **≥ 85%** for `revenue`, `cashFlow`, `city`/`MSA`, `industry`, `brokerName`. Coverage: golden-set. Test: `packages/scraper/adapters/businessbroker/tests/field-precision.test.ts` (TBD V1).

### Search URL round-trip
- **Given** any sanitized real businessbroker.net search URL, **when** parsed and re-serialized, **then** the regenerated URL produces the same first page of results. Coverage: golden-set. Test: `packages/scraper/adapters/businessbroker/tests/search-url-roundtrip.test.ts` (TBD V1).

### Drift / freshness
- **Given** businessbroker.net canary fixtures, **when** the daily canary completes, **then** zero parser-drift signals fire; two consecutive failures degrade the adapter. Coverage: smoke. Test: `services/adapter-canary/tests/businessbroker.test.ts` (TBD V1).

### Cross-link
- Inherits scraper wisdom and operational guarantees from [`packages/scraper/agents.md`](../../agents.md).
