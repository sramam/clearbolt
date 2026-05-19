# `packages/scraper/adapters/bizquest`

V1 adapter. Often syndicated with broker listings; valuable for cross-source dedup against BizBuySell.

## Adapter API

- `parseSearchUrl(url) -> BizQuestSavedSearchParams`
- `discoverListingRefs(params) -> AsyncIterable<ListingRef>`
- `fetchListingDetail(ref) -> RawSourceRecord`
- `extractBrokerLinks(record) -> BrokerEndpoint[]`

## Notes

- Many BizQuest listings appear simultaneously on BizBuySell — the dedup pipeline should fold them into the same `CanonicalDeal` with two `SourceRecord`s.
- Anti-bot posture: lighter than BizBuySell; HTTP lane likely sufficient most of the time.

## Broker directory discovery

BizQuest publishes a broker directory searchable by state, county, and city (same parent network as BizBuySell). Broker directory pages yield `BrokerDirectoryRef`s; listing pages yield `ListingRef`s.

- URL grammar: `/business-brokers/` and state/county/city facets (TBD in implementation).
- HTTP lane likely sufficient; share broker materialization keys with BizBuySell when the same broker appears on both marketplaces ([data-model.md](../../../../docs/architecture/data-model.md#broker-materialization-workflow)).
- Sub-adapter: [`packages/broker-directory`](../../../broker-directory/agents.md) `bizquest-dir`.

`TODO:` Fill detail extraction shape + canary fixtures once V1 adapter work begins.

## Validation criteria

### Adapter contract
- **Given** the BizQuest adapter, **when** the `Adapter` conformance suite from `packages/scraper/src/conformance/adapter.suite.ts` runs, **then** all assertions pass. Coverage: integration. Test: `packages/scraper/adapters/bizquest/tests/conformance.test.ts` (TBD V1).

### Field extraction (golden-set)
- **Given** the labeled fixture corpus in `packages/scraper/adapters/bizquest/tests/fixtures/detail/*`, **when** parsed, **then** **per-field precision ≥ 95%** for `title`, `askingPrice`, `state`; **≥ 85%** for `revenue`, `cashFlow`, `city`/`MSA`, `industry`, `brokerName`. Coverage: golden-set. Test: `packages/scraper/adapters/bizquest/tests/field-precision.test.ts` (TBD V1).
- **Given** any extracted field, **when** stored, **then** field-level provenance is recorded. Coverage: integration.

### Broker enrichment (marketplace)
- **Given** a listing detail fixture with broker fields, **when** `extractBrokerLinks` runs, **then** it returns ≥0 typed `BrokerEndpoint`s with `profileUrl` when the page links a BizQuest broker profile. Coverage: unit. Test: `packages/scraper/adapters/bizquest/tests/extract-broker-links.test.ts` (TBD V1).
- **Given** a broker directory page fixture, **when** broker-directory discovery runs, **then** each entry yields a `BrokerDirectoryRef` with `profileUrl` and `sourceAdapter: "bizquest"`. Coverage: unit. Test: `packages/scraper/tests/bizquest-broker-directory.test.ts` (TBD V1).
- **Given** the same broker on BizQuest and BizBuySell (same `websiteDomain`), **when** both listings ingest, **then** materialization produces one `Broker` row with two `sources` entries. Coverage: integration. Test: `packages/storage-neon/tests/bizquest-bbs-broker-merge.test.ts` (TBD V1).

### Cross-source dedup (the reason this adapter exists)
- **Given** a BizQuest listing also appearing on BizBuySell, **when** dedup runs, **then** they are merged into the same `CanonicalDeal` with two `SourceRecord`s. Coverage: golden-set. Test: `packages/dedup/tests/golden-corpus.test.ts::bizquest-bizbuysell-cross-merge` (TBD V1). Falsifiability for the "syndication overlap" claim that justifies adding this adapter.

### Search URL round-trip
- **Given** any sanitized real BizQuest search URL, **when** parsed and re-serialized, **then** the regenerated URL produces the same first page of results. Coverage: golden-set. Test: `packages/scraper/adapters/bizquest/tests/search-url-roundtrip.test.ts` (TBD V1).

### Drift / freshness
- **Given** BizQuest canary fixtures, **when** the daily canary completes, **then** zero parser-drift signals fire; two consecutive failures degrade the adapter. Coverage: smoke. Test: `services/adapter-canary/tests/bizquest.test.ts` (TBD V1).

### Cross-link
- Inherits scraper wisdom and operational guarantees from [`packages/scraper/agents.md`](../../agents.md).
