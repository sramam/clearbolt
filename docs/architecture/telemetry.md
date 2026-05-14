# Telemetry

How Clearbolt observes itself and its users — for engineers debugging incidents, for the agent platform team improving prompts, for PMs measuring product impact, and for searchers seeing their own activity.

This is the design doc. The decision is in [ADR 0014](../decisions/0014-telemetry-stack.md). The contracts live in [`packages/telemetry/agents.md`](../../packages/telemetry/agents.md) (product + agent traces) and [`packages/observability/agents.md`](../../packages/observability/agents.md) (logs / traces / metrics). Cross-cuts [observability.md](observability.md).

## The four-layer model

| Layer | Owner package | V0 backend | V1+ backend | Audience |
|---|---|---|---|---|
| 1. Operational metrics (TSDB) | `packages/observability` `MetricsSink` | noop default; opt-in VictoriaMetrics via docker-compose | VictoriaMetrics on Fly | engineers, on-call |
| 2. Operational logs + traces | `packages/observability` `Logger` + `Tracer` | pino → stdout; noop tracer | pino → OTel log exporter; OTel SDK + OTLP exporter | engineers debugging |
| 3. Product analytics + agent run traces | `packages/telemetry` `ProductEvents` | docs only (V1+ scaffold) | self-hosted PostHog on Fly | PMs, designers, growth, agent platform team, end users |
| 4. Observability UI | `apps/web` `/admin` route | none | V1: PostHog embeds + VM proxy. V2: full federated native UI | all of the above |

Each layer has a contract; each backend is plug-replaceable; each layer can be queried independently or joined on shared identifiers (`workspaceId`, `userId`, `sessionId`, `traceId`).

## Identity model

Every telemetry event carries:

- `workspaceId` — the tenant boundary ([ADR 0012](../decisions/0012-multi-tenancy-workspace-as-tenant.md)).
- `userId` — the actor (may be `system` for background jobs).
- `sessionId` — for harness/agent runs, this is the harness session; for UI, it is the browser session.
- `traceId` + `spanId` — OTel-compatible; propagates between layers so a Layer 2 span can be correlated with a Layer 3 product event.
- `runtime` — `workers` | `node` (which side of the hybrid topology emitted this).
- `service` + `version` — for tracing release-correlated regressions.

The same identifiers appear in:

- pino log fields (Layer 2).
- OTel span attributes (Layer 2).
- VM metric labels (Layer 1, where cardinality permits — `workspaceId` is too high-cardinality for VM labels at scale; bucketed instead).
- PostHog event properties (Layer 3).

This means: a slow harness session in PostHog can be drilled into Tempo for the span tree and into VM for the per-tool-call cost — all by the same `traceId`.

## Layer 1 — Operational metrics

VictoriaMetrics single-binary container in dev (port 8428, persistent volume). The CLI exposes `/metrics` Prometheus-text when `CLEARBOLT_METRICS_VM_URL` is set; VM scrapes on its own schedule.

### Metric naming convention

`clearbolt_<subsystem>_<unit>_<aggregation>` — e.g.:

- `clearbolt_fetch_request_duration_seconds` (histogram)
- `clearbolt_fetch_request_total` (counter, labelled by `adapter`, `lane`, `outcome`)
- `clearbolt_dedup_decision_total` (counter, labelled by `decision`, `adapter`)
- `clearbolt_harness_session_cost_usd_total` (counter, labelled by `model`, `task`)
- `clearbolt_queue_job_duration_seconds` (histogram, labelled by `queue`, `outcome`)
- `clearbolt_ai_token_total` (counter, labelled by `model`, `direction` (in/out))

Cardinality discipline: never label by `workspaceId` or `userId` directly. Use bucketed labels (`workspace_size_bucket`, `user_role`) or aggregate into a separate per-workspace metric only on flush.

### Default ops dashboards (V1+ admin UI panels)

1. **Scraper health.** Fetch p95 by adapter + lane; WAF block rate; AIA failure rate; needsBrowser-promotion rate.
2. **Dedup decisions.** Decisions/min by decision type; MergeCandidate queue depth; per-contributor score histograms.
3. **Harness cost.** Cost/min by model + task; tokens/min by direction; eval pass rate.

V1.5 review picks the production target (single-VM stays, cluster, Grafana Cloud, or Chronosphere).

## Layer 2 — Operational logs and traces

pino on stdout in V0 and V1. CF Workers route stdout to Logpush; Fly routes to its log shipper. V1+ adds an OTel log exporter so logs stream to a structured backend (Loki / Datadog / Honeycomb chosen at V1.5).

### What we instrument

See [observability.md](observability.md) for the full menu. Highlights:

- Every fetcher request: adapter, URL, lane (HTTP/browser), throttle state, WAF detection, AIA outcome, duration, status.
- Every dedup decision: candidate count, score breakdown, decision, MergeCandidate queue depth.
- Every harness turn: harness ID, session ID, workspaceId, skill/task, model, prompt version, token usage, cost, tool calls, validation result.
- Every wiki maintainer page write: workspaceId, path, sha256, source artifact ID, maintainer version.
- Every queue job: name, payload size, duration, retries, outcome.
- Every capture: source URL host, host-heuristic match, defuddle conversion success, AI extraction structured-shape result.
- Every transcript: tier, cost, quality-gate triggers.

### Span hierarchy

A typical V1 trace looks like:

```
saved_search.run               (root, Layer 2)
├─ scraper.fetch_search        (HTTP fetch)
├─ scraper.fetch_listing[]     (per listing)
│  ├─ scraper.tls.aia          (one-time per host)
│  ├─ scraper.waf.detect       (after each fetch)
│  └─ scraper.adapter.parse
├─ dedup.pipeline              (per source record)
│  ├─ dedup.keyer.derive
│  ├─ dedup.scorer.score[]     (per candidate)
│  └─ dedup.decider.decide
└─ wiki.maintainer.ingest      (if new canonical)
   ├─ harness.session          (Layer 3 cross-link)
   │  └─ ai.call[]             (per LLM call; cost + tokens)
   └─ wiki.write[]             (per page touched)
```

Each span has the identity model fields plus span-specific attributes. The `harness.session` span emits a corresponding Layer 3 `agent_session_started` / `_completed` event so PostHog and the trace backend can be joined.

## Layer 3 — Product analytics + agent run traces

Self-hosted PostHog on Fly handles both. One event store, one identity graph, one query plane.

### Events catalog (V1 starter set)

User-facing events (Layer 3 / product analytics):

- `user.signed_up`, `user.signed_in`, `workspace.created`
- `saved_search.created`, `saved_search.ran`, `saved_search.opened`
- `listing.viewed`, `listing.liked`, `listing.disliked`, `listing.saved`, `listing.passed`, `listing.hidden`
- `deal.opened`, `deal.note_added`, `deal.status_changed`
- `wiki.page_viewed`, `wiki.query_asked`, `wiki.feedback_given`
- `capture.created`, `capture.confirmed`, `capture.discarded`
- `outreach.email_drafted`, `outreach.email_sent`, `outreach.reply_received`
- `feature_flag.evaluated`

Agent-run events (Layer 3 / LLM observability via PostHog generations):

- `agent.session_started` (workspaceId, sessionId, harnessVersion, taskName)
- `agent.tool_called` (toolName, args summary, outcome, duration)
- `agent.llm_called` (model, promptVersion, inputTokens, outputTokens, costUsd, cacheHit)
- `agent.validator_ran` (resultSchemaName, pass, errors[])
- `agent.eval_scored` (datasetId, fixtureId, score, judgeModel)
- `agent.session_completed` (status: success | failure | abandoned, totalCostUsd, totalTokens)

Joining keys: `sessionId` joins `agent.*` events into a single agent run; `traceId` joins them with Layer 2 spans; `userId` + `workspaceId` join with Layer 3 user events for "did this prompt change move the funnel?" queries.

### Privacy and consent

Default: workspace-private. Every event carries `workspaceId`; PostHog projects are partitioned per workspace at the data layer (V1: separate PostHog "team" per workspace; V1.5: revisit if scaling demands). UI dashboards inside the workspace show only that workspace's events.

Cross-workspace product analytics (e.g., "across all workspaces, the wiki-query reformulation rate is X%") are computed by a nightly de-identification pipeline:

- Strip `workspaceId`, `userId`, free-text fields, and any monetary value above a workspace-private precision threshold.
- Bucket numerics: revenue/EBITDA/asking_price get bucketed to log-spaced ranges; geographies get bucketed to MSA; industries to NAICS-2 only.
- Resulting "anonymous" project is read-only for the Clearbolt product team; powers product roadmap decisions and prompt-eval cohort analysis.
- Every workspace owner can opt out of cross-workspace aggregation entirely; default is opt-in for new workspaces with clear copy.

Sensitive fields that **never** leave the workspace, regardless of consent:

- Buyer financial profile values (assets, liabilities, lender terms).
- Outreach recipient PII (names, emails, phone numbers).
- Capture content from private deal networks (Axial teasers, CIMs, NDA-bound documents).
- Wiki content (markdown body, citations).

These can drive within-workspace funnels and personalization; cross-workspace they are aggregated only as ratios and counts (e.g., "average outreach attempts per deal across cohorts").

### Closed feedback loop into AI quality

The reason product + agent traces live in the same store: we want one query that says, "users who saw prompt version X had a 3% higher save-rate than users who saw prompt version Y." This is what makes "improve agentic or otherwise" mechanically tractable.

Pipeline:

1. Every `agent.llm_called` event records `promptVersion`.
2. Feature flags (PostHog) gate which prompt version a user sees.
3. Product events (`listing.saved`, `outreach.reply_received`, `wiki.feedback_given`) are joined with the prompt version cohort.
4. The agent platform team queries the cohort difference and either rolls out the better version or rolls back.

Eval golden sets (per [V2 phase](../phases/V2.md)) feed off this same data: "borderline" cases that surface in production become labeled fixtures.

## Layer 4 — Observability UI

V0: none. V1: minimal. V2: full federated.

### V1 minimal `/admin` (in `apps/web`)

- **Embedded PostHog dashboards** — 3-5 curated dashboards via signed `<iframe>` (PostHog supports JWT-scoped embeds). Funnel, retention, cohorts, LLM costs.
- **System metrics panel** — server-side proxy to VM `/api/v1/query` for ~3 charts:
  - Fetch p95 by adapter (last 24h).
  - Dedup decisions/min by type (last 24h).
  - Harness session cost/min (last 24h).
- **Links out** — direct deep-links to the raw PostHog UI for power users; direct deep-link to VM UI; direct deep-link to log/trace backend.

V1 admin auth: `member` of the workspace can see workspace-scoped panels; `admin` of the workspace can see workspace-private operational metrics; `clearbolt-staff` role (cross-tenant) can see aggregated panels.

### V2 full federated UI

- Native React panels for VM, logs/traces, PostHog.
- Cross-source linking: click a span → see related product events → see related dedup decisions, all in one workflow.
- All visual styling matches the rest of the app; operators never leave the product.
- Saved views per workspace; shareable URLs.
- Per-workspace cost dashboards with explicit "this is your spend, this is your AI cost, this is your storage cost" breakdown — searcher-facing transparency.

## How this composes with the other principles

- **Pluggable everything**: each layer is a contract with swappable backends. PostHog can be replaced with Langfuse + Mixpanel; VM can be replaced with Grafana Cloud; OTel exporters can target any vendor.
- **Hybrid CF + Fly**: every emitter (Worker or Fly node) writes to the same backends. Identity propagation is unified.
- **Specs include validation criteria**: every event in the catalog has a corresponding spec assertion in `packages/telemetry/agents.md`'s validation criteria block; the PostHog ingest endpoint is asserted via integration tests.
- **Karpathy LLM wiki**: the wiki maintainer's session traces feed PostHog's LLM observability; eval scores against the wiki's golden-set fixtures live in the same store as product events.

## Validation criteria

### Functional
- **Given** a CLI run with `CLEARBOLT_METRICS_VM_URL=http://localhost:8428` and the docker-compose VM container running, **when** the run completes, **then** at least one `clearbolt_fetch_request_total` series appears in VM. Coverage: smoke. Test: `apps/cli/tests/metrics-endpoint.smoke.test.ts::vm_scrapes_cli_metrics` (V0).
- **Given** a V1 user opens `/admin` while signed into a workspace they own, **when** the embedded PostHog dashboard loads, **then** it shows only that workspace's events (asserted by injecting a known cross-workspace event and confirming it does not appear). Coverage: integration. Test: `apps/web/tests/admin-posthog-scoped.test.ts` (TBD V1).
- **Given** a V1 capture flow, **when** the user clicks "Confirm to CRM", **then** `capture.created` and `capture.confirmed` events arrive in PostHog within 5 seconds. Coverage: integration. Test: `apps/web/tests/capture-events.test.ts` (TBD V1).

### Non-functional
- **Given** a V1 production deployment, **when** measured over a rolling 7-day window, **then** the client-to-PostHog event delivery success rate is ≥ 99%. Coverage: smoke (production telemetry on telemetry). Test: `scripts/telemetry-health.mjs::posthog_delivery_rate_99pct` (TBD V1).
- **Given** a V1 production deployment, **when** measured over a rolling 7-day window, **then** the VM ingest lag p95 is < 30s. Coverage: smoke. Test: `scripts/telemetry-health.mjs::vm_ingest_lag_p95_under_30s` (TBD V1).

### Failure modes
- **Given** PostHog is unreachable for 5 minutes, **when** the client tries to send events, **then** events buffer locally (up to 10 MB / 1000 events per browser tab) and flush on reconnect; no events are dropped silently. Coverage: integration. Test: `packages/telemetry/tests/buffer-and-flush.test.ts` (TBD V1).
- **Given** a workspace owner opts out of cross-workspace aggregation, **when** the nightly de-identification pipeline runs, **then** their workspace's events are not present in the anonymous project. Coverage: integration. Test: `services/deidentify/tests/opt-out-honored.test.ts` (TBD V1.5).

### Privacy
- **Given** any field marked sensitive in the events catalog, **when** the de-identification pipeline runs, **then** the field is dropped or bucketed before reaching the anonymous project. Coverage: property test over the events catalog. Test: `services/deidentify/tests/sensitive-fields-stripped.property.test.ts` (TBD V1.5).
- **Given** a CCPA/GDPR data-subject delete request for a userId, **when** the delete job runs, **then** all events for that userId are removed from PostHog within 30 days, AND the per-userId log entries are scrubbed from the log backend within 30 days. Coverage: integration. Test: `services/dsr/tests/delete-userId-end-to-end.test.ts` (TBD V1.5).

## Open questions

- [ ] V1.5: do we keep one PostHog "team" per workspace (clean privacy boundary, more ops) or one PostHog instance with per-workspace properties (simpler ops, harder boundary)? Resolved when we have data on cross-workspace query needs.
- [ ] V1: where does the agent eval golden-set live — PostHog Datasets, a Postgres table, or both? Resolved when we ship the V2 eval harness.
- [ ] V2: full federated UI — buy (Grafana embeds) or build (native React panels)? Resolved by V1.5 user research.

## ADRs

- [ADR 0014 — Telemetry stack](../decisions/0014-telemetry-stack.md)
- [ADR 0010 — Hybrid Cloudflare + Fly.io deployment](../decisions/0010-deployment-hybrid-cf-fly.md) (every layer respects the runtime split)
- [ADR 0012 — Workspaces as tenant boundary](../decisions/0012-multi-tenancy-workspace-as-tenant.md) (privacy boundary inherits)
- [ADR 0015 — Specs include validation criteria](../decisions/0015-specs-include-validation-criteria.md) (events catalog has criteria; ingest endpoints are testable)
