# BizBuySell via Apify (optional fallback)

Apify is kept as an **optional fallback** `Fetcher` backend per [ADR 0013](../../../../docs/decisions/0013-apify-as-optional-fallback.md). Default: off.

## Why we keep it documented

- Three public Apify actors target BizBuySell. They handle Akamai for us at a per-call price.
- Useful when our in-house HTTP + Playwright lane breaks (Akamai posture change) and we need data now.
- Useful for bootstrapping a new BizBuySell-adjacent site if Apify already has a parser there.
- Operationally cheaper than running a 2 AM incident response in some cases.

## Why it is not the default

- **Cost**: Apify charges per-call; over time, our in-house lane is cheaper at sustained volume.
- **Lock-in**: Apify's actor schemas and platform behavior are outside our control.
- **Duplication**: We are already paying the engineering cost to handle Akamai (see [`packages/scraper/agents.md`](../../agents.md)). Defaulting to Apify would let that knowledge atrophy.
- **Latency**: Apify run lifecycle (queue, run, poll for results) is slower than direct fetch.

## Public actors (reference)

- [`acquistion-automation/bizbuysell-scraper`](https://apify.com/acquistion-automation/bizbuysell-scraper/reviews)
- [`fatihtahta/bizbuysell-scraper`](https://apify.com/fatihtahta/bizbuysell-scraper)
- [`crawlerbros/bizbuysell-scraper`](https://apify.com/crawlerbros/bizbuysell-scraper)

Use them as references for product behavior and operational constraints (search URL input, pagination, detail-page enrichment, Akamai handling, proxy support, run-level deduplication). Do not let their schemas become our internal domain model — `ApifyFetcher` always maps Apify output into our `RawSourceRecord` shape.

## When to enable

Per workspace per adapter via env / feature flag:

```
CLEARBOLT_FETCHER_APIFY_BIZBUYSELL=enabled
APIFY_TOKEN=...
APIFY_BIZBUYSELL_ACTOR=acquistion-automation/bizbuysell-scraper
```

Cost is tracked against the workspace's enrichment budget per [`docs/operations/cost-budgets.md`](../../../../docs/operations/cost-budgets.md).

## Implementation contract

`ApifyFetcher` implements the `Fetcher` interface. From the rest of the scraper's perspective it is just another fetcher — adapters and consumers do not branch on it.

```ts
class ApifyFetcher implements Fetcher {
  constructor(opts: { actorId: string; token: string; mapResult: (apifyItem: unknown) => RawSourceRecord });

  async fetch(req: FetchRequest): Promise<RawResponse> {
    // 1. POST to Apify run-sync API
    // 2. parse response
    // 3. map(apifyItem) -> RawResponse with rawHtml field replaced by structured payload
    // 4. record provenance: { fetcher: 'apify', actorId, runId, costUsd }
  }
}
```

## Validation criteria

### Default-off (hard rule)
- **Given** any fresh deployment, **when** workspace × adapter Apify env flags are not set, **then** `ApifyFetcher` is **not** instantiated and is **not** in the `Fetcher` selection chain. Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/apify-default-off.test.ts` (TBD V1). Falsifiability for ADR 0013's "default off" claim.

### Fetcher-contract conformance
- **Given** `ApifyFetcher` enabled with a configured actor, **when** the `Fetcher` conformance suite runs against it, **then** all assertions pass: returns a `RawResponse` with `status`, `body` (or structured payload), `finalUrl`, `headers`, `evidenceRef`. Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/apify-fetcher-conformance.test.ts` (TBD V1).
- **Given** `ApifyFetcher` output, **when** mapped via `mapResult`, **then** the resulting `RawSourceRecord` passes the same downstream conformance as records from `HttpFetcher` / `BrowserFetcher` (no special-casing in adapters). Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/apify-record-shape-parity.test.ts` (TBD V1).

### Provenance
- **Given** any record sourced via `ApifyFetcher`, **when** stored, **then** provenance carries `{ fetcher: 'apify', actorId, runId, costUsd }`. Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/apify-provenance-stamped.test.ts` (TBD V1).

### Cost attribution (hard rule)
- **Given** any `ApifyFetcher` run, **when** complete, **then** `costUsd` is recorded against the workspace's enrichment budget envelope (separate from the AI budget). Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/apify-cost-attributed.test.ts` (TBD V1). Cross-link to [`docs/operations/cost-budgets.md`](../../../../docs/operations/cost-budgets.md).
- **Given** the workspace's enrichment budget cap, **when** reached, **then** further `ApifyFetcher` runs are rejected with `BudgetExceededError`. Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/apify-budget-cap.test.ts` (TBD V1).

### Fallback semantics
- **Given** `ApifyFetcher` enabled and the in-house lane marked `degraded`, **when** a fetch is requested, **then** Apify is selected; **when** the in-house lane recovers, **then** Apify is no longer selected (no permanent fallback drift). Coverage: integration. Test: `packages/scraper/adapters/bizbuysell/tests/apify-degraded-fallback.test.ts` (TBD V1).

### Cross-link
- ADR: [`docs/decisions/0013-apify-as-optional-fallback.md`](../../../../docs/decisions/0013-apify-as-optional-fallback.md).
