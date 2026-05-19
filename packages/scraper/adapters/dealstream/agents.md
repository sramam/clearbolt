# `packages/scraper/adapters/dealstream`

V1+ adapter. Mixed-quality broad marketplace; can surface oddball industrial/service deals.

## Adapter API

- `parseSearchUrl(url) -> DealStreamSavedSearchParams`
- `discoverListingRefs(params) -> AsyncIterable<ListingRef>`
- `fetchListingDetail(ref) -> RawSourceRecord`
- `extractBrokerLinks(record) -> BrokerEndpoint[]`

Broker profile parser: `packages/scraper/src/adapters/dealstream-broker-parse.ts`.

`TODO:` Fill search URL shape, anti-bot notes, and canary fixtures once V1+ adapter work begins.

## Validation criteria

### Broker enrichment (marketplace)
- **Given** a labeled DealStream broker profile fixture, **when** `parseDealStreamBrokerProfilePage` runs, **then** `activeListings` contains ≥1 card with `url` and `externalId`. Coverage: unit. Test: `packages/scraper/tests/dealstream-broker-parse.test.ts` (TBD V1.5).
- **Given** a listing detail fixture, **when** `extractBrokerLinks` runs, **then** it returns ≥0 `BrokerEndpoint`s with `profileUrl` when present. Coverage: unit. Test: `packages/scraper/adapters/dealstream/tests/extract-broker-links.test.ts` (TBD V1.5).
- **Given** a broker profile with N active listings that ingest successfully, **when** broker materialization runs, **then** one `Broker` row and N `BrokerListing` rows exist. Coverage: integration. Test: `packages/storage-neon/tests/dealstream-broker-materialization.test.ts` (TBD V1.5).

### Adapter contract
- **Given** the DealStream adapter, **when** the `Adapter` conformance suite from `packages/scraper/src/conformance/adapter.suite.ts` runs, **then** all assertions pass. Coverage: integration. Test: `packages/scraper/adapters/dealstream/tests/conformance.test.ts` (TBD V1.5).

### Field extraction (golden-set)
- **Given** the labeled fixture corpus, **when** parsed, **then** **per-field precision ≥ 95%** for `title`, `askingPrice`, `state`; **≥ 80%** for `revenue`, `cashFlow`, `city`/`MSA`, `industry`, `brokerName`. Note: lower thresholds reflect mixed-quality source. Coverage: golden-set. Test: `packages/scraper/adapters/dealstream/tests/field-precision.test.ts` (TBD V1.5).
- **Given** any extracted record, **when** stored, **then** a `sourceQualityHint` field is populated (`high` | `medium` | `low`) that the dedup `Scorer` uses to weight DealStream records appropriately. Coverage: integration. Test: `packages/scraper/adapters/dealstream/tests/source-quality-hint.test.ts` (TBD V1.5).

### Search URL round-trip
- **Given** any sanitized real DealStream search URL, **when** parsed and re-serialized, **then** the regenerated URL produces the same first page of results. Coverage: golden-set. Test: `packages/scraper/adapters/dealstream/tests/search-url-roundtrip.test.ts` (TBD V1.5).

### Drift / freshness
- **Given** DealStream canary fixtures, **when** the daily canary completes, **then** zero parser-drift signals fire; two consecutive failures degrade the adapter. Coverage: smoke. Test: `services/adapter-canary/tests/dealstream.test.ts` (TBD V1.5).

### Cross-link
- Inherits scraper wisdom and operational guarantees from [`packages/scraper/agents.md`](../../agents.md).
