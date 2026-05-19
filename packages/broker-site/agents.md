# `packages/broker-site`

> Runtime: **node** (Fly.io). Crawls **broker-owned websites** (not marketplaces) to discover listings and emit `SourceRecord`s with `adapter: "broker-site"`.

## Mission

After [`packages/broker-directory`](../broker-directory/agents.md) (or marketplace broker enrichment) materializes a `Broker` row with `websiteDomain`, this package fetches the broker's public "businesses for sale" / "listings" pages and ingests observations into the shared dedup graph ([data-model.md](../../docs/architecture/data-model.md)).

Broker sites are bespoke. **V0** uses HTTP/browser fetch + Defuddle markdown + an LLM extraction skill; **V1.5+** may add franchise-specific bespoke parsers (Sunbelt, Transworld) as plugins.

## Contract

```typescript
BrokerSiteCrawler {
  crawlBrokerListings(broker: BrokerRow, options?: CrawlOptions): AsyncIterable<BrokerSiteListingObservation>;
}

BrokerSiteListingObservation {
  sourceUrl: string;
  parsedFields: Record<string, unknown>;  // Zod-validated via skill
  rawEvidenceRef: EvidenceRef;
  brokerId: string;
}

CrawlOptions {
  allowListOnly?: boolean;      // default true in V1 production
  maxPagesPerBroker?: number;
  tokenBudgetPerBroker?: number;
}
```

Ingest path: observations → `ingestSourceRecord` in [`packages/dedup`](../dedup/agents.md) with `adapter: "broker-site"` and external id derived from URL path or listing slug.

## `broker-site-extract` skill (packages/agents)

Harness skill consumed by the crawler:

- **Input:** Defuddle markdown + page URL + optional broker context (`displayName`, `firmName`, `state`).
- **Output (Zod):** `{ listings: [{ title, askingPrice?, currency?, state?, city?, revenue?, cashFlow?, industry?, listingUrl? }] }`.
- **Prompt versioning:** `promptVersion` on resulting `SourceRecord`s per [ai-usage.md](../../docs/architecture/ai-usage.md).

Lower precision bar than marketplace adapters (bespoke HTML):

| Field | Target precision (N=20 golden sites) |
|-------|--------------------------------------|
| `title`, `askingPrice`, `state` | ≥ 85% |
| `revenue`, `cashFlow`, `industry` | ≥ 75% |

## Bespoke parser plugins (V1.5+)

```typescript
BrokerSiteParserPlugin {
  matches(hostname: string): boolean;
  parseListings(html: string, url: string): BrokerSiteListingObservation[];
}
```

Register high-volume franchise hosts (e.g. `*.sunbeltnetwork.com`) before falling back to LLM extraction. Plugins live under `packages/broker-site/src/plugins/`.

## Index pagination (custom per site)

Broker listing indexes use heterogeneous pagers (`?page=`, `?paged=`, `rel=next`, “Next” nav, franchise-specific classes). The crawler does **not** assume one pattern per broker.

- **Strategies:** reuse [`packages/scraper` pagination strategies](../scraper/src/discovery/pagination/) via `discoverNextBrokerSiteIndexPageUrl` (`rel-next` → broker pager selectors → nav “Next” → `?paged=` → `?page=`).
- **Walk:** `walkBrokerSiteIndexPages` fetches each index URL until no next page or `maxPagesPerIndex` (CLI `--pages`, env `CLEARBOLT_BROKER_SITE_MAX_INDEX_PAGES`; `0` = unlimited).
- **Checkpoint:** `data/broker-site-crawls/<host>__<path>.json` stores `listingUrls` plus per-index `indexPagination[]` (`pagesFetched`, `lastPageUrl`, `nextPageUrl`, `complete`, `lastPaginationStrategy`). Resume is automatic when the file exists and `complete` is false.
- **Future:** franchise `BrokerSiteParserPlugin` may supply site-specific `PaginationStrategy[]` before the generic stack (V1.5).

## Gating and safety

- **Allow-list:** `CLEARBOLT_BROKER_SITE_ALLOWLIST` — comma-separated registrable domains; production crawl refuses hosts not on the list (V1 preview).
- **Robots:** respect `packages/scraper` robots policy (`robots-policy.ts`) per host.
- **Cooldown:** on `no-website`, `robots-disallow`, or repeated errors, set `Broker.enrichmentStatus` and do not retry until [`listing-fetch-cooldown`](../dedup/src/listing-fetch-cooldown.ts) window elapses.
- **Pocket listings:** no cross-source corroboration — freshness and dedup confidence rules in [open.md](../../docs/decisions/open.md).

## LLM cost

~3k–5k broker firms × pages per site × tokens per page. Default `tokenBudgetPerBroker` and short-circuit when budget exhausted ([open.md](../../docs/decisions/open.md)). Cost attributes to workspace enrichment budget when run on behalf of a tenant.

## Validation criteria

### Contract
- **Given** a broker on the allow-list with a fixture HTML listings page, **when** `BrokerSiteCrawler.crawlBrokerListings` runs with `MockFetcher`, **then** it yields ≥1 `BrokerSiteListingObservation` with `sourceUrl` and `brokerId`. Coverage: integration. Test: `packages/broker-site/tests/crawler-fixture.test.ts` (TBD V1).

### Allow-list
- **Given** a `Broker.websiteDomain` not on `CLEARBOLT_BROKER_SITE_ALLOWLIST`, **when** crawl is requested in production mode, **then** the crawl is skipped and `enrichmentStatus` is unchanged. Coverage: unit. Test: `packages/broker-site/tests/allowlist-blocks.test.ts` (TBD V1).

### Enrichment status
- **Given** a broker website with no public listings index (or robots disallow), **when** `BrokerSiteCrawler` runs, **then** `Broker.enrichmentStatus` becomes `no-website` or `error` and no retry occurs before the listing-fetch cooldown window. Coverage: integration. Test: `packages/broker-site/tests/enrichment-status-cooldown.test.ts` (TBD V1).

### LLM golden-set
- **Given** the labeled fixture corpus of 20 hand-picked broker sites in `packages/broker-site/tests/fixtures/golden/`, **when** `broker-site-extract` runs, **then** per-field precision meets the table above. Coverage: golden-set. Test: `packages/broker-site/tests/golden-eval.test.ts` (TBD V1).

### Ingest / dedup
- **Given** a broker-site observation ingested, **when** the same listing later appears on BizBuySell, **then** dedup merges into one `CanonicalDeal` with two `SourceRecord`s. Coverage: integration. Test: `packages/dedup/tests/broker-site-marketplace-merge.test.ts` (TBD V1).

### Plugins
- **Given** a Sunbelt franchise fixture and the Sunbelt plugin registered, **when** crawl runs, **then** the LLM skill is not invoked for that host. Coverage: unit. Test: `packages/broker-site/tests/sunbelt-plugin.test.ts` (TBD V1.5).

### Pagination checkpoint
- **Given** a broker index HTML fixture with `rel=next` or `?page=2` links, **when** `discoverNextBrokerSiteIndexPageUrl` runs, **then** it returns the next URL and a non-null `strategyId`. Coverage: unit. Test: `packages/broker-site/tests/broker-site-pagination.test.ts`.
- **Given** a partial crawl state with `nextPageUrl` and `complete: false`, **when** `runBrokerSiteCrawl` resumes, **then** it continues from that page without re-fetching completed index pages. Coverage: integration. Test: `packages/broker-site/tests/crawl-resume-pagination.test.ts` (TBD V1).
- **Given** a finished index walk, **when** the crawl state file is read, **then** `indexPagination[].complete` is true and `nextPageUrl` is null. Coverage: unit. Test: `packages/broker-site/tests/broker-site-crawl-state.test.ts`.

### Cross-link
- Decision: [ADR 0016](../../docs/decisions/0016-broker-direct-ingestion-lane.md)
- Directory enumeration: [broker-directory/agents.md](../broker-directory/agents.md)
- Harness / Zod: [packages/agents/agents.md](../agents/agents.md)
