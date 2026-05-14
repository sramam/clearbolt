# `packages/scraper/adapters/loopnet`

V1+ adapter. Business + commercial real estate listings; useful when real estate is part of the thesis.

## Special considerations

- Listings often combine business operations + property; the adapter should preserve both as separate fields and link them.
- Real-estate-only listings (no business attached) should be filtered or marked.

`TODO:` Fill in adapter API stubs, parser shape, anti-bot notes, and canary fixtures once V1+ adapter work begins.

## Validation criteria

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
