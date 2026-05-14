# Cost controls and budgets

LLM, embeddings, scraping, browser automation, proxies, storage, and search all have real costs. Bake controls in early.

## Controls

- **Per-workspace budgets** for LLM and enrichment operations; soft warn and hard cap.
- **Per-adapter throttles** for HTTP fetches, browser sessions, proxy bandwidth, and external actor calls (Apify per [ADR 0013](../decisions/0013-apify-as-optional-fallback.md)).
- **Per-feature budgets** for embedding generation, dedup re-runs, replay jobs.
- **Caching everywhere**: response caching, embedding caching, prompt-cache-friendly prompt structure. AI Gateway in front of model calls is the highest-leverage cost-control work.

## Visibility

- **Cost dashboards** by workspace, adapter, feature, and model.
- **Anomaly alerts** for cost spikes (e.g. dedup re-run misfires, runaway browser sessions, paid-transcript fallback firing too often).
- **Per-run cost** stamped on harness artifacts for explainability.

## V1 cost shape (rough)

For 50 workspaces, 250 saved searches refreshing hourly, ~360k page fetches/mo:

- **Compute** (CF + Fly): $120-190/mo combined. CF Pages + Workers + Workflows for client-facing edge; Fly machines for scraper, transcribe, agent runners, queue worker, write API.
- **Neon** (Postgres + pgvector): $20-100/mo on Launch -> Scale tier.
- **R2**: $5-15/mo storage + ops, growing linearly.
- **AI**: $700-6,000/mo. Dominates cost. Composition:
  - Extraction (per-listing structured field extraction): high volume, cheap model.
  - Wiki maintainer (ingest/query/lint): medium volume, mid-tier model.
  - Embeddings (dedup `vector` contributor + wiki search): high volume, very cheap.
  - Paid transcribe fallbacks (Gemini / OpenAI Whisper): variable, capped.

Compute is 5-15% of total. AI dominates. Topology choice (CF vs Fly) is rounding error against AI spend.

## Cost-attribution model

`TODO:` Decide vendor cost-attribution model, billing primitives, and whether to expose usage to end users. Likely:

- AI Gateway tags every request with `workspaceId`, `feature`, `prompt-version`, `model`.
- Pull from AI Gateway analytics into `MetadataStore` periodically for in-product reporting.
- Per-workspace monthly cap on paid transcribers.
- Per-workspace soft warn at 80% of budget; hard cap at 100%.

## Apify (optional fallback)

If `ApifyFetcher` is enabled per workspace per adapter, its costs are tracked separately and counted against the workspace's enrichment budget. Default off.

## Validation criteria

Operations docs use measurable thresholds. If a threshold is breached, the corresponding operational response (alert, page, budget enforcement, manual review) must trigger.

### Functional
- **Given** a workspace with a configured monthly AI budget, **when** spend reaches 80%, **then** a soft-warn notification is sent to the workspace owner. Coverage: integration. Test: `services/ai-budget/tests/soft-warn-at-80.test.ts` (TBD V1).
- **Given** a workspace with a configured monthly AI budget, **when** spend reaches 100%, **then** further AI calls are rejected with `BudgetExceededError`. Coverage: integration. Test: `services/ai-budget/tests/hard-cap-at-100.test.ts` (TBD V1).
- **Given** AI Gateway is configured, **when** any model call is made, **then** the request is tagged with `workspaceId`, `feature`, `promptVersion`, and `model`. Coverage: integration. Test: `packages/ai/tests/gateway-tags.test.ts` (TBD V1).
- **Given** an opt-in `ApifyFetcher` for workspace × adapter, **when** Apify runs, **then** the cost is recorded against the workspace's enrichment budget (separate envelope from AI budget). Coverage: integration. Test: `packages/scraper/tests/apify-cost-attributed.test.ts` (TBD V1).

### Thresholds (V1+ production)
- **Given** the V1+ production deployment, **when** measured monthly, **then** total infra cost (CF + Fly + Neon + R2) is between 5% and 20% of total spend. Coverage: smoke (monthly cost report). Triggers ADR 0010 falsifiability if breached.
- **Given** the V1+ production deployment, **when** measured monthly, **then** AI cost per active workspace is between $10 and $200. Coverage: smoke. Response: investigate per-workspace usage profile if outside the range.
- **Given** any single workspace, **when** its hourly AI spend exceeds 5× its 7-day rolling hourly average, **then** an anomaly alert fires. Coverage: integration. Test: `services/ai-budget/tests/anomaly-alert.test.ts` (TBD V1.5).

### Failure modes
- **Given** AI Gateway is unreachable, **when** a model call would be made, **then** the call falls back to direct provider with degraded caching (and a warning is logged). Coverage: integration. Test: `packages/ai/tests/gateway-fallback.test.ts` (TBD V1).
