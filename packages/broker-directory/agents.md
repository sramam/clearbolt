# `packages/broker-directory`

> Runtime: **node** (Fly.io). Enumerates broker firms from public directories; does **not** fetch listing detail pages (that is [`packages/scraper`](../scraper/agents.md) for marketplaces and [`packages/broker-site`](../broker-site/agents.md) for broker-owned sites).

## Mission

Produce `BrokerCandidate` rows for shared `Broker` / `BrokerFirm` materialization ([data-model.md](../../docs/architecture/data-model.md#broker-materialization-workflow)). Directory observation is evidence-backed: each candidate carries `sourceAdapter`, `profileUrl` or license id, and optional contact fields.

## Contract

```typescript
BrokerDirectoryAdapter {
  id: string;  // e.g. "bbs-dir", "ibba", "sunbelt"
  discoverBrokers(params: BrokerDirectoryParams): AsyncIterable<BrokerCandidate>;
}

BrokerCandidate {
  normalizedName: string;
  displayName?: string;
  firmName?: string;
  websiteDomain?: string;   // registrable domain, lowercased
  profileUrl?: string;
  state?: string;
  phone?: string;
  email?: string;
  designations?: string[];  // e.g. CBI, M&AMI (IBBA)
  sourceAdapter: string;
  externalId?: string;
  rawEvidenceRef?: EvidenceRef;
}
```

Conformance suite: `packages/broker-directory/src/conformance/broker-directory.suite.ts` (TBD).

Materialization (upsert `Broker` / `BrokerFirm`, merge `sources`) lives in `packages/storage-neon` — not in this package.

## Sub-adapters

| Sub-adapter | Source | Enumeration strategy | ToS / crawl posture |
|-------------|--------|----------------------|---------------------|
| `bbs-dir` | BizBuySell `/business-brokers/{state}/` | Reuse scraper catalog walk → `BrokerDirectoryRef`; Akamai / browser lane | **Listing marketplace ToS applies** — treat as high legal risk for automated crawl; production requires explicit legal sign-off ([open.md](../../docs/decisions/open.md)). Prefer marketplace broker-profile parser (Part A) before bulk directory crawl. |
| `bizquest-dir` | BizQuest broker directory (state/county/city) | Same pattern as `bbs-dir`; HTTP lane likely sufficient | Same parent network as BBS — same legal review gate. |
| `ibba` | IBBA members directory (`ibba.org`) | Form/search by state; capture firm + designations; **no listings** on directory pages | Trade-association directory — generally lower risk than listing data; still verify robots + terms before production. |
| `sunbelt` | Sunbelt Network location pages | Franchise location URL grammar; high-confidence office list | Franchise public locator — document per-site robots; bespoke parser plugin in V1.5 for listing index pages on sunbelt.com. |
| `transworld` | Transworld Business Advisors locations | Same as Sunbelt | Same posture as Sunbelt. |
| `state-dre/ca` | California DRE / business broker license lookup | Query by license type; export name + license # + address | Government data — verify reuse terms (often public records); rate-limit aggressively. |
| `state-dre/fl` | Florida DBPR | TBD URL + query interface in implementation spike | Same as CA. |
| `state-dre/az` | Arizona ADRE | TBD URL + query interface in implementation spike | Same as CA. |

Additional state adapters follow the `state-dre/{code}` pattern only after a per-state ToS row is added to this table ([open.md](../../docs/decisions/open.md)).

## Relationship to `packages/scraper`

- Marketplace **broker directory pages** (BBS, BizQuest) are discovered using scraper pagination (`walkCatalogPages`) but classified as `BrokerDirectoryRef`, not `ListingRef` ([bizbuysell/agents.md](../scraper/adapters/bizbuysell/agents.md#broker-directory-discovery)).
- `bbs-dir` and `bizquest-dir` sub-adapters wrap that discovery output into `BrokerCandidate`.

## V0 / V1 scope

- **V1 preview:** `bbs-dir` + `ibba` only; output written to `MetadataStore` `Broker` rows; no broker-site crawl unless domain is on allow-list ([broker-site/agents.md](../broker-site/agents.md)).
- **V1.5:** `sunbelt`, `transworld`, `state-dre/{ca,fl,az}` ([V1.5.md](../../docs/phases/V1.5.md)).

## Validation criteria

### Contract
- **Given** any `BrokerDirectoryAdapter` backend, **when** the conformance suite runs, **then** `discoverBrokers` yields at least one `BrokerCandidate` with `normalizedName` and at least one of `websiteDomain | profileUrl | firmName` populated. Coverage: integration. Test: `packages/broker-directory/src/conformance/broker-directory.suite.ts` (TBD V1).

### Dedup / materialization
- **Given** a `BrokerCandidate` whose `websiteDomain` matches an existing `Broker` row, **when** materialized, **then** no duplicate `Broker` is created and `sources` gains an entry for this `sourceAdapter`. Coverage: integration. Test: `packages/storage-neon/tests/broker-directory-materialization.test.ts` (TBD V1).
- **Given** BBS broker-profile materialization and IBBA directory materialization for the same person (same `websiteDomain` + compatible `normalizedName`), **when** both run, **then** exactly one `Broker` row exists with two source entries. Coverage: integration. Test: `packages/storage-neon/tests/broker-cross-source-merge.test.ts` (TBD V1).

### Sub-adapters
- **Given** a BizBuySell broker directory HTML fixture, **when** `bbs-dir` discovery runs, **then** every yielded candidate has `sourceAdapter: "bbs-dir"` and a `profileUrl` under `/business-broker/`. Coverage: unit. Test: `packages/broker-directory/tests/bbs-dir.test.ts` (TBD V1).
- **Given** an IBBA member search results fixture, **when** `ibba` discovery runs, **then** candidates include `firmName` and optional `designations`. Coverage: unit. Test: `packages/broker-directory/tests/ibba.test.ts` (TBD V1).

### Operational
- **Given** a sub-adapter marked `disabled` in config, **when** a scheduled enumeration job runs, **then** that adapter is skipped and no fetch occurs. Coverage: integration. Test: `packages/broker-directory/tests/adapter-disabled-skip.test.ts` (TBD V1).

### Cross-link
- Decision: [ADR 0016](../../docs/decisions/0016-broker-direct-ingestion-lane.md)
- Data model: [data-model.md](../../docs/architecture/data-model.md#brokers)
- Broker-site crawl: [broker-site/agents.md](../broker-site/agents.md)
