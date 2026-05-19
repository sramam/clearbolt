# `packages/scraper/adapters/businessbroker`

Pre-V1: **catalog discovery** + **listing ingest** with broker contact from the listing detail page (`Contact:` in `.contact_seller_content`). V1: conformance suite + golden-set field precision.

Broker-listed local deals; good for services, retail, restaurants, light industrial. HTTP catalog pages work without Playwright in local dev.

## Catalog discovery (CLI `clearbolt catalog --discover-only`)

Regional and facet catalogs use `?page=N` query pagination:

- Example: `https://www.businessbroker.net/state/california-businesses-for-sale.aspx`, then `?page=2`, … until no next page or an empty listing page.
- Also supported: `/industry/*-businesses-for-sale.aspx`, `/keyword/*`, `/city/*`, `/county/*`.
- **`businessBrokerCatalogAdapter`** (`packages/scraper/src/adapters/businessbroker/catalog.ts`) discovers `/business-for-sale/{slug}/{id}.aspx` anchors and merges by listing id.
- Listing ingest fetches each detail page and stores `brokerName` (contact person), financials from Quick Facts, and description. Broker profile URLs are not on listing pages today.
- CLI: `clearbolt catalog <url> --ingest N` or `--discover-only` for refs only.

## Broker enrichment (listing-side)

BusinessBroker.net exposes broker contact as `brokerName` on the listing detail page (no marketplace broker-profile URL today). Materialization uses `parsedFields.brokerName` + firm string when present; `extractBrokerLinks` may return an empty array until profile URLs are discovered.

## Validation criteria

### Catalog discovery (pre-V1)
- **Given** a California catalog HTML fixture, **when** `discoverListingRefsFromBusinessBrokerCatalogPage` runs, **then** it returns refs with numeric `externalId` and canonical `www` listing URLs. Coverage: unit. Test: `packages/scraper/tests/businessbroker-catalog.test.ts`.
- **Given** catalog HTML with `?page=2` pager links, **when** `discoverNextBusinessBrokerCatalogPageUrl` runs on page 1, **then** the next URL is page 2. Coverage: unit. Test: `packages/scraper/tests/businessbroker-catalog.test.ts`.
- **Given** the `businessbroker-listing-1010506` HTML fixture, **when** `parseBusinessBrokerListingPage` runs, **then** `brokerName`, `askingPrice`, `revenue`, and `cashFlow` match labeled values. Coverage: unit. Test: `packages/scraper/tests/businessbroker-listing-parse.test.ts`.
- **Given** `clearbolt catalog <businessbroker catalog url> --ingest 1`, **when** the command completes, **then** ingested `SourceRecord.parsedFields.brokerName` is set when the listing page shows `Contact:`. Coverage: smoke. Test: manual / future CLI smoke.

### Broker enrichment (marketplace)
- **Given** the `businessbroker-listing-1010506` fixture, **when** `parseBusinessBrokerListingPage` runs, **then** `brokerName` is populated and broker materialization can upsert a `Broker` row keyed by `normalizedName` + firm (no `websiteDomain` required). Coverage: unit. Test: `packages/scraper/tests/businessbroker-listing-parse.test.ts`.
- **Given** a listing `SourceRecord` with `parsedFields.brokerName`, **when** broker materialization runs after ingest, **then** `CanonicalDeal.brokerId` is set and a `BrokerListing` row exists. Coverage: integration. Test: `packages/storage-neon/tests/businessbroker-broker-materialization.test.ts` (TBD V1).

### Adapter contract (V1)

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
