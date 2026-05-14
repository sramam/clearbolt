# Observability

Operational view of Clearbolt — Layers 1 + 2 of the [telemetry stack](telemetry.md). Covers logs, traces, and metrics that engineers and on-call use to debug and operate the system.

For Layer 3 (product analytics + agent run traces, audience PMs / designers / agent platform / end users), see [telemetry.md](telemetry.md) and [`packages/telemetry/agents.md`](../../packages/telemetry/agents.md).

Owner: [`packages/observability`](../../packages/observability/agents.md). Contracts: `Logger`, `Tracer`, `MetricsSink`. V0 default `pino` + opt-in VictoriaMetrics dev container; V1+ OpenTelemetry exporter to chosen backend (Loki/Tempo/Honeycomb/Datadog at V1.5) plus VictoriaMetrics on Fly. ADR: [0014](../decisions/0014-telemetry-stack.md).

## What to log and measure

### Ingestion

- Source adapter, URL, job ID, workspace ID where applicable.
- Strategy: HTTP, browser, import, external actor.
- Duration, retries, outcome, error class.
- Extraction version and confidence.
- Per-domain throttle state (concurrent requests, recent error rate, AIMD state).
- WAF detection events (challenge, block, rate-limited).
- Browser fallback rate per domain.
- TLS / AIA outcomes.

### Dedup

- Candidate counts per blocking key.
- Score distribution.
- Auto-merge / review-queued / new-canonical decisions.
- `MergeCandidate` queue depth.

### Harness (Layer 2 spans; Layer 3 events emitted in parallel)

- Harness run ID, session ID, workspace ID.
- Skill / task name.
- Model, prompt version, harness version.
- Token usage and cost per call.
- Tool calls (which tool, args, outcome).
- Result schema validation pass/fail.
- Evaluator pass/fail and human approval events.

The `harness.session` span (Layer 2) and `agent.session_started` / `_completed` event (Layer 3) carry identical `sessionId` + `traceId` so they can be joined.

### Search

- Lexical query latency.
- Vector candidate quality (recall samples on known duplicate sets).
- Shared-cache hit rate.
- Workspace overlay latency (filter + re-rank).
- Feedback-driven ranking impact (A/B vs unranked baseline).

### Capture (universal clipper)

- Captures per workspace per day.
- Per-host heuristic hit rate.
- Defuddle conversion success.
- Wiki-ingest skill outcomes.

### Transcripts

- Tier used (youtube / whisper-local / gemini / openai).
- Cost per transcript.
- Quality-gate triggers (escalations to paid tier).

### Outreach

- Attempts, replies, bounces, opt-outs, next-action completion rates.

### Costs

- Per-workspace, per-feature, per-model spend.
- AI Gateway cache hit rate.
- Per-run cost stamped on harness artifacts.

## Tracing

Use `Tracer` (OpenTelemetry-compatible) for cross-service traces:

- CF Worker `POST /api/captures` → queue enqueue → Fly capture worker → wiki maintainer.
- Saved-search trigger → scraper run → dedup → wiki ingest.

A typical V1 trace span tree appears in [telemetry.md §Span hierarchy](telemetry.md#span-hierarchy).

## Testing strategy

This section concerns tests of the observability code itself (V0 plumbing) and conventions for tests of code that emits telemetry. The broader project testing strategy lives in [testing-strategy.md](testing-strategy.md).

- Fixture tests for saved HTML/JSON snapshots (scraper).
- Contract tests for `parseSearchUrl` using sanitized real URLs.
- Conformance tests for `EvidenceStore`, `MetadataStore`, `WikiStore` (run against disk + R2 + Neon backends).
- Dedup tests with known duplicate/non-duplicate pairs.
- Retrieval tests for deterministic, lexical, vector, and hybrid candidate generation.
- Harness contract tests for market definition, quality-of-deal, wiki-ingest, wiki-query, wiki-lint.
- Import tests for messy CSVs and user-provided lists.
- Ranking tests for affordability scenarios and explainable score outputs.
- Personalization tests for likes/dislikes, passes, hidden listings, and workspace isolation.
- Outreach workflow tests for suppression lists, next actions, and provider webhooks.
- Roadmap provider lead-routing tests for consent, specialty matching, and shared-field audit logs.
- E2E smoke tests only where network dependency and ToS risk are acceptable.

## Validation criteria

### Functional
- **Given** any code path that performs a fetch, **when** it emits a `clearbolt_fetch_request_total` counter increment, **then** the metric carries `adapter`, `lane`, and `outcome` labels (no `workspaceId` / `userId`). Coverage: unit + cardinality lint. Test: `packages/observability/tests/cardinality-guard.test.ts` (TBD V1).
- **Given** a CF Worker request, **when** the request creates a span, **then** the span propagates `traceId` to any downstream Fly request via the `traceparent` header. Coverage: integration. Test: `packages/observability-otel-traces/tests/cf-fly-trace-propagation.test.ts` (TBD V1).
- **Given** a harness session, **when** `Tracer.startSpan('harness.session', ...).end()` is called, **then** the span attributes include `sessionId`, `workspaceId`, `userId`, `task`, `model`, and the corresponding Layer 3 event in PostHog carries the same `sessionId` + `traceId`. Coverage: integration. Test: `packages/agents/tests/cross-layer-identity.test.ts` (TBD V1).

### Non-functional
- **Given** a V1+ production deployment, **when** measured over 7 days, **then** OTel trace export success rate is ≥ 99% and median export latency is < 5 seconds. Coverage: smoke. Test: `scripts/telemetry-health.mjs::otel_trace_export_99pct` (TBD V1).
- **Given** the V1+ VM backend on Fly, **when** measured over 7 days, **then** scrape success rate is ≥ 99.5% and ingest lag p95 is < 30s. Coverage: smoke. Test: `scripts/telemetry-health.mjs::vm_scrape_success_995pct` (TBD V1).

### Failure modes
- **Given** the OTel backend is unreachable, **when** the application emits spans, **then** the application continues running and dropped exports are accounted for via `clearbolt_observability_export_drop_total`. Coverage: integration. Test: `packages/observability-otel-traces/tests/exporter-degraded.test.ts` (TBD V1).

### Privacy
- **Given** a log line that would otherwise include a sensitive field (per the `packages/telemetry` sensitive-field deny-list), **when** `Logger.info` is called, **then** the field is redacted to `[REDACTED]` in the output. Coverage: unit. Test: `packages/observability/tests/logger-redaction.test.ts` (TBD V1).

## Open questions

- [ ] V1.5: final OTel log + trace backend choice (Loki / Tempo / Honeycomb / Datadog). Resolved by V1.5 cost + DX review.
- [ ] V1.5: VM topology (single VM, cluster, Grafana Cloud, Chronosphere). Resolved when we have ~30 days of V1 signal volume.
- [ ] V1: do we expose per-workspace ops metrics in the workspace UI (transparency to the searcher) or keep them operator-only? Default operator-only; revisit if users ask.

## ADRs

- [ADR 0014 — Telemetry stack](../decisions/0014-telemetry-stack.md)
- [ADR 0010 — Hybrid Cloudflare + Fly.io deployment](../decisions/0010-deployment-hybrid-cf-fly.md)
- [ADR 0015 — Specs include validation criteria](../decisions/0015-specs-include-validation-criteria.md)
