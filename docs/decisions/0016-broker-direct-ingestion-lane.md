# ADR 0016 — Broker-direct ingestion lane (sibling packages)

Status: accepted

## Context

Clearbolt ingests business-for-sale listings primarily through marketplace adapters (`packages/scraper`). Most US brokered inventory appears on aggregators (BizBuySell, BizQuest, BusinessesForSale, LoopNet, DealStream). Marketplace adapters already expose broker contact via `extractBrokerLinks` and broker-profile parsers (BizBuySell, DealStream).

A second lane — **broker-direct** — enumerates broker firms from public directories (IBBA, franchise networks, state license databases, marketplace broker directories) and crawls each broker's own website for listings. Motivations:

- **Pocket listings** that never syndicate to aggregators.
- **Earlier freshness** on broker-owned pages before marketplace indexing.
- **Broker graph** as a first-class shared entity for enrichment and wiki ([data-model.md](../architecture/data-model.md#brokers)).

Broker websites are heterogeneous (~3k–5k US firms). Site-specific parsers do not scale; an LLM extraction skill over Defuddle markdown is the V0 broker-site approach.

## Decision

Add two **sibling packages** to `packages/scraper` (not new marketplace `Adapter`s inside it):

| Package | Contract | Role |
|---------|----------|------|
| [`packages/broker-directory`](../../packages/broker-directory/agents.md) | `BrokerDirectoryAdapter.discoverBrokers` | Enumerate `BrokerCandidate`s from public directories |
| [`packages/broker-site`](../../packages/broker-site/agents.md) | `BrokerSiteCrawler` | Fetch broker-owned sites; emit `SourceRecord`s with `adapter: "broker-site"` |

**Part A (marketplace-first)** remains the primary listing volume path: finish marketplace listing parse + lift `BrokerEndpoint` / `parsedFields.brokerName` into shared `Broker` / `BrokerFirm` / `BrokerListing` rows ([data-model.md](../architecture/data-model.md#broker-materialization-workflow)).

**Part B (broker-direct)** ships after Part A specs and `Broker*` migrations land. V1 preview is **gated**: allow-listed broker domains only, BBS + IBBA enumeration first. Full Sunbelt / Transworld / state-DRE rollout is [V1.5](../phases/V1.5.md).

Broker-direct `SourceRecord`s use the same dedup spine as marketplace records; pocket listings without cross-source corroboration follow a separate freshness policy ([open.md](open.md)).

Legal posture: per-source ToS review before enabling each `BrokerDirectoryAdapter` sub-adapter in production ([open.md](open.md)).

## Alternatives considered

1. **New `Adapter` implementations inside `packages/scraper` for IBBA, Sunbelt, etc.** Rejected: directories are not listing marketplaces; mixing broker enumeration with listing adapters blurs the `Adapter` contract and conformance suite.
2. **Skip broker-direct; marketplace-only.** Rejected for now — pocket listings and broker graph value justify a bounded second lane; falsifiability below defines when to defer Part B.
3. **Site-specific parsers for every broker domain.** Rejected at V0 scale; optional bespoke plugins only for high-volume franchise templates (Sunbelt, Transworld) in V1.5+.

## Consequences

- New Prisma models `Broker`, `BrokerFirm`, `BrokerListing` ([packages/db/agents.md](../../packages/db/agents.md)).
- LLM cost for `broker-site-extract` must be budgeted per broker ([open.md](open.md)).
- Dedup must merge broker entities across marketplace and directory observations, not only listings.
- Operators need an allow-list and robots policy before broker-site crawl in production.

## Falsifiability criteria

- **Trigger (defer Part B):** After Part A ships, ≥ **90%** of `CanonicalDeal`s observed in a 30-day window already have ≥1 marketplace `SourceRecord` (BizBuySell, BizQuest, BFS, LoopNet, or DealStream), and broker-direct adds **< 5%** net-new canonical deals in a pilot allow-list crawl.
  **Measurement:** SQL on `canonical_deals.sources` vs new deals whose first `SourceRecord.adapter = 'broker-site'`.
  **Response:** Pause broker-site rollout; keep directory enumeration for broker graph only.
- **Trigger (continue Part B):** Broker-direct pilot adds ≥ **5%** net-new canonical deals OR ≥ **15%** of ingested deals gain a broker-site `SourceRecord` as first-seen source on an allow-listed domain.
  **Measurement:** same query; 30-day pilot window.
  **Response:** proceed with V1.5 franchise + state-DRE adapters per [V1.5.md](../phases/V1.5.md).
- **Trigger (LLM path insufficient):** Golden-set precision on `broker-site-extract` falls below **75%** for `title` + `askingPrice` + `state` on N=20 labeled broker sites for two consecutive eval runs.
  **Measurement:** `packages/broker-site/tests/golden-eval.test.ts`.
  **Response:** invest in franchise bespoke parsers or narrow allow-list; do not expand crawl breadth.
- **Trigger (ToS block):** A directory or broker-site source sends cease-and-desist or blocks sustained crawl after operator review.
  **Measurement:** incident log + adapter disable flag.
  **Response:** remove sub-adapter from production config; document in per-source ToS table in [broker-directory/agents.md](../../packages/broker-directory/agents.md).
