# ADR 0014 — Telemetry stack: VictoriaMetrics + OpenTelemetry + self-hosted PostHog, federated via in-house admin UI

Status: accepted

## Context

We need three distinct telemetry layers, plus a UI to view them:

1. **Operational metrics** (time-series) — fetcher latency, queue depth, AI tokens-by-model, error rates by adapter, harness session cost. Audience: on-call engineers.
2. **Operational logs and traces** — structured logs and span trees for incident debugging. Audience: engineers debugging.
3. **Product analytics + agent run traces** — UI events, funnels, cohorts, feature flags, session replay, plus per-LLM-call generation events tied back to product context. Audience: PMs, designers, growth, agent platform team, plus the user themselves (their own activity).

These layers have different audiences, different retention, different privacy posture, and different consumption surfaces. They cannot be served by a single tool well, but they can share a unified UI experience.

Constraints:

- **Privacy-first.** Buyer financial profile is sensitive. Workspace data is private. We commit to family-office-grade posture from V1.
- **Hybrid deployment.** Cloudflare Workers + Fly.io ([ADR 0010](0010-deployment-hybrid-cf-fly.md)). Both runtimes need to emit to all three layers.
- **Optionality.** We do not want to lock telemetry data inside any single vendor we cannot leave.
- **One coherent UX.** Operators and users should not bounce between three vendor consoles to understand the system.

## Decision

Four layers, each with a clear backend story for V0/dev and V1+/prod, federated through one in-house admin UI in V1+.

### Layer 1 — Operational metrics

- **Contract:** `MetricsSink` in `packages/observability`.
- **V0 dev backend:** **VictoriaMetrics** single-binary container, started by `docker-compose -f docker-compose.dev.yml up`. The CLI exposes a `/metrics` Prometheus-text endpoint when `CLEARBOLT_METRICS_VM_URL` is set; VM scrapes it.
- **V0 default backend:** noop (zero deps; opt-in to VM via env var).
- **V1+ backend:** VictoriaMetrics on Fly (single VM with persistent volume; cluster vs Grafana Cloud vs Chronosphere choice **deferred to V1.5** when we have ~30 days of signal volume to design against).

### Layer 2 — Operational logs and traces

- **Contract:** `Logger` + `Tracer` in `packages/observability`.
- **Logger backend:** pino → stdout in V0; OTel log exporter in V1+ (target backend Loki / Datadog / Honeycomb chosen at V1.5).
- **Tracer backend:** noop in V0; OpenTelemetry SDK with OTLP exporter in V1+ (target backend Tempo / Honeycomb chosen at V1.5).
- **Span correlation:** every harness session opens a root span; HTTP fetches, AI calls, dedup decisions, capture conversions, wiki ops, queue jobs all hang under it.

### Layer 3 — Product analytics + agent run traces

- **Contract:** `ProductEvents` in new `packages/telemetry` (V1+ scaffold; V0 ships `agents.md` only).
- **Backend:** **self-hosted PostHog** on Fly.io.
- **Why one tool for both:** PostHog covers product analytics (events, funnels, cohorts, feature flags, session replay) AND has matured LLM observability (per-call generation events, prompt management, evals tied to product events). Joining product + agent events in one place lets us answer "did the new ranking prompt move the save-rate funnel?" with a single query.
- **Why self-host:** family-office-grade privacy posture from day one; no PII / financial-profile / capture-content egress to a third party; full ownership of the event store; no vendor lock-in on retention or pricing.
- **Privacy default:** workspace-private. Cross-workspace aggregation requires explicit consent and runs through a de-identification pipeline (no raw values, only buckets and distributions).
- **Escape hatch:** if agent-quality work later demands deeper trace shape than PostHog provides, we add **Langfuse** as a second backend behind the same `ProductEvents` contract, with no consumer changes. Initial direction: PostHog first; Langfuse only if we run into it.

### Layer 4 — Observability UI

- **V0:** none. CLI users `tail -f` logs and `curl http://localhost:8428/api/v1/query` if they enabled VM.
- **V1 (minimal):** `/admin` route inside `apps/web`:
  - Embeds 3-5 PostHog dashboards via signed `<iframe>` (PostHog supports per-user JWT-scoped embeds).
  - "System metrics" panel that proxies VM `/api/v1/query` for ~3 core charts (fetch p95 by adapter, dedup decisions/min, harness session cost/min).
  - Links out to the raw PostHog UI for power users.
- **V2 (full):** native React panels for VM + logs/traces backend + PostHog, federated. Cross-source linking (click a span → see related product events → see related dedup decisions). All visual styling matches the rest of the app; operators never leave the product.

### How the four layers compose

| Audience | What they look at | Where it lives |
|---|---|---|
| On-call engineer | latency p95, error rates, queue depth, AI cost/min | VM (Layer 1) via /admin or VM UI |
| Engineer debugging an incident | a specific span's children, the failing log | Logs/traces backend (Layer 2) |
| PM / designer / growth | funnel from "scrape" → "save" → "outreach", per-feature usage | PostHog (Layer 3) via /admin embeds |
| Agent platform team | prompt versions, eval scores, generation costs by model and call-site | PostHog LLM views (Layer 3) |
| Searcher (end user) | their own activity history, saved deals, outreach status | Workspace UI (Layer 3 read-side, scoped) |

## Consequences

- **V0 cost:** zero by default; opt-in to VM via docker-compose for engineers who want local metrics.
- **V1 cost:** ~$30-60/mo for one Fly VM running self-hosted PostHog (Postgres + ClickHouse + PostHog services); ~$5-10/mo for VictoriaMetrics on Fly. Negligible compared to AI cost.
- **Operational burden:** running our own PostHog adds ~2-3 hours/quarter of patch/upgrade time. Worth it for the privacy posture.
- **Vendor independence:** PostHog is open-source; if we ever need to migrate, the event schema is portable. Same for VM (Prometheus-compatible) and OTel (vendor-neutral).
- **Privacy compliance:** the four-layer split makes it easy to point at a layer and explain what is in it, who can read it, and what the retention is. CCPA/GDPR data-subject requests can be answered per layer.
- **Closed loop into AI quality:** PostHog product events + LLM events live in the same query plane, so "users who saw this prompt version had a 3% higher save-rate" is a single SQL query. This is what makes "improve agentic or otherwise" mechanically possible.

## Alternatives considered

- **PostHog Cloud (managed).** Simpler ops; faster to ship V1; ~$0-50/mo at our V1 volume. Rejected for privacy posture: financial profile data and capture content cannot egress to a third-party event store under family-office expectations.
- **Mixpanel / Amplitude / Segment.** Closed-source SaaS; weak self-host story; weaker LLM observability. Rejected for both privacy and lock-in.
- **OpenTelemetry-only with a custom warehouse.** All three layers as OTel signals into Tempo + Loki + Mimir + a custom analytics layer. Rejected for V1 — too much DIY for the value; we re-evaluate at V2/V3 if PostHog becomes a bottleneck.
- **Vector PostHog with Langfuse from day one.** Two tools from V1. Rejected: PostHog covers both for our V1 scale; Langfuse becomes additive when needed.
- **Snowplow / Jitsu.** Heavy event pipeline. Rejected: overkill for V1 volume; PostHog gives us the event pipeline + UI in one binary.
- **Honeycomb / Datadog for ops.** Excellent products. Rejected for V1 default — same privacy and lock-in concern; we keep them as options for the V1.5 OTel exporter target.

## Falsifiability criteria

- **Trigger**: PostHog self-hosted VM consumes more than 4 hours/quarter of operational attention (patches, restarts, debugging).
  **Measurement**: log time spent against a `posthog-ops` tag in our task system.
  **Response**: revisit; consider PostHog Cloud with a privacy-engineering review, or switch to the OTel-only path.
- **Trigger**: more than 5% of tracked product events fail to deliver from the client to PostHog over a 7-day window.
  **Measurement**: client-side success counter vs server-side ingest counter; alert at 1%.
  **Response**: investigate ingest path (CF Worker → PostHog), consider buffering at edge.
- **Trigger**: agent platform team requests a feature PostHog LLM observability does not support and Langfuse does (e.g., span-tree visualization beyond 3 levels, per-tool-call cost breakdown, structured eval datasets).
  **Measurement**: feature requests filed against `packages/telemetry` referencing capability gaps.
  **Response**: add Langfuse as a second backend behind the same `ProductEvents` contract; do not migrate, just compose.
- **Trigger**: privacy review finds we are sending workspace-private fields to PostHog without consent.
  **Measurement**: routine privacy audit + automated test that asserts the de-identification pipeline on cross-workspace events.
  **Response**: hard incident; pause cross-workspace aggregation, fix the pipeline, post-mortem.
- **Trigger**: V1.5 review finds VictoriaMetrics has hit a single-VM ceiling we cannot tune past.
  **Measurement**: VM ingest lag > 60s sustained, or query latency p95 > 5s.
  **Response**: switch to the deferred decision (VM cluster vs Grafana Cloud vs Chronosphere).

## References

- [docs/architecture/telemetry.md](../architecture/telemetry.md)
- [docs/architecture/observability.md](../architecture/observability.md)
- [packages/telemetry/agents.md](../../packages/telemetry/agents.md)
- [packages/observability/agents.md](../../packages/observability/agents.md)
- [ADR 0010 — Hybrid Cloudflare + Fly.io deployment](0010-deployment-hybrid-cf-fly.md)
- [ADR 0012 — Workspaces as tenant boundary](0012-multi-tenancy-workspace-as-tenant.md) (privacy boundary inherits the workspace tenancy model)
