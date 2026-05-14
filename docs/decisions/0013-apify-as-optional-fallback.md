# ADR 0013 — Apify retained as optional `Fetcher` fallback (default off)

Status: accepted

## Context

The prior project's Akamai handling — AIA TLS, AIMD throttling, WAF heuristics, `needsBrowser` persistence, browser-like headers, SPA detection — is being lifted directly into [`packages/scraper`](../../packages/scraper/agents.md). At sustained volume, in-house fetching is cheaper and faster than calling out to Apify.

But Apify offers operational value:

- Three public actors target BizBuySell and handle Akamai for us at a per-call price.
- Useful when our in-house lane breaks for an extended period (Akamai posture change) and we need data **now**.
- Useful when bootstrapping a new BizBuySell-adjacent site if Apify already has a parser there.
- Cheaper than running a 2 AM incident response in some failure modes.

## Decision

Keep Apify as a **documented optional `Fetcher` backend** (`ApifyFetcher`). **Default: off.**

- Apify is not used by the scraper unless explicitly enabled per workspace per adapter via env / feature flag.
- When enabled, Apify cost counts against the workspace's enrichment budget per [`docs/operations/cost-budgets.md`](../../docs/operations/cost-budgets.md).
- `ApifyFetcher` always maps Apify output into Clearbolt's `RawSourceRecord` shape — third-party schemas never become our internal domain model.
- Apify run metadata (actor ID, run ID, cost) is preserved on the resulting `SourceRecord` for audit.

Public actors retained as references in [`packages/scraper/adapters/bizbuysell/apify.md`](../../packages/scraper/adapters/bizbuysell/apify.md):

- `acquistion-automation/bizbuysell-scraper`
- `fatihtahta/bizbuysell-scraper`
- `crawlerbros/bizbuysell-scraper`

## Consequences

- Default behavior remains in-house lanes (HTTP + Playwright) per [`packages/scraper/agents.md`](../../packages/scraper/agents.md).
- No new runtime dependency unless `ApifyFetcher` is enabled.
- Operational escape hatch exists for emergencies.
- Cost / lock-in concerns avoided by keeping it opt-in.
- If we ever grow into needing Apify routinely (e.g. a site we're not willing to maintain in-house), the contract makes wiring it a config change.

## Falsifiability criteria

- **Trigger**: `ApifyFetcher` becomes the default for any workspace × adapter combination without an explicit decision recorded in this ADR or a follow-up.
  **Measurement**: env config audit on workspace defaults.
  **Response**: revisit; if "default on" is the right call, that is a separate ADR.
- **Trigger**: Apify cost exceeds in-house scraper compute cost on a sustained basis (3 months) for any adapter where it is enabled.
  **Measurement**: cost-per-listing comparison joining `Apify` run cost with Fly compute cost attributed to the same adapter.
  **Response**: stop using Apify for that adapter; in-house is supposed to be cheaper at sustained volume.
- **Trigger**: Apify schema drift breaks the `RawSourceRecord` mapping more than 2× in 6 months.
  **Measurement**: parser-drift telemetry on `ApifyFetcher` runs.
  **Response**: revisit the integration; consider deprecating if upstream is too unstable to wrap.
- **Trigger**: a workspace is unable to enable Apify within ~5 minutes via env / feature flag (operational friction).
  **Measurement**: time-to-enable on the next "in-house lane is down" incident.
  **Response**: simplify the toggle; the value proposition is "Apify saves you from a 2 AM incident."
- **Trigger**: data captured via Apify ends up in `MetadataStore` with `source: 'apify'` instead of the underlying adapter (e.g. `bizbuysell`).
  **Measurement**: lint on `RawSourceRecord` shape.
  **Response**: incident; the contract requires Apify to map into the adapter's domain shape, not invent its own.
