# `packages/observability`

> Runtime: **both**.

Layers 1 + 2 of the [telemetry stack](../../docs/architecture/telemetry.md): operational metrics (TSDB), operational logs, and operational traces. Audience: engineers debugging the system.

Distinct from [`packages/telemetry`](../telemetry/agents.md) (Layer 3 — product analytics + agent run traces, audience PMs / designers / agent platform team / end users). Distinct in retention, permissions, privacy posture, and backends.

ADR: [0014 — Telemetry stack](../../docs/decisions/0014-telemetry-stack.md). Cross-cuts [`docs/architecture/observability.md`](../../docs/architecture/observability.md).

## Contracts

```ts
interface Logger {
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

interface Tracer {
  startSpan(name: string, attrs?: Record<string, unknown>): Span;
}

interface Span {
  setAttribute(key: string, value: unknown): void;
  recordException(err: unknown): void;
  end(): void;
  addEvent(name: string, attrs?: Record<string, unknown>): void;
}

interface MetricsSink {
  counter(name: string, value?: number, attrs?: Record<string, unknown>): void;
  gauge(name: string, value: number, attrs?: Record<string, unknown>): void;
  histogram(name: string, value: number, attrs?: Record<string, unknown>): void;
  // V1+: optional Prometheus-text endpoint exposure for VM scrape
  toPrometheusText?(): string;
}
```

## Backends

### V0

| Contract | Backend | Notes |
|---|---|---|
| `Logger` | `pino` → stderr | Structured JSON; default fields propagated via `child()` |
| `Tracer` | noop (or in-memory span buffer for inspection) | No exporter |
| `MetricsSink` (default) | noop | Zero deps |
| `MetricsSink` (opt-in) | `vm-metrics` (Prometheus-text endpoint) | Activated by `CLEARBOLT_METRICS_VM_URL` env var; CLI exposes `/metrics`, scraped by VictoriaMetrics docker container |

VM dev backend: `docker-compose -f docker-compose.dev.yml up victoriametrics` starts a single-binary VM container on port 8428 with a persistent volume at `./data/vm`. Scrape config targets the CLI's `/metrics` endpoint at `host.docker.internal:9091`. Instructions in root `README.md`.

### V1+

| Contract | Backend | Notes |
|---|---|---|
| `Logger` | `pino` → stdout, OTel log exporter sibling | CF Workers route stdout to Logpush; Fly routes to OTel exporter; final log backend (Loki / Datadog / Honeycomb) chosen at V1.5 |
| `Tracer` | OpenTelemetry SDK + OTLP exporter | Final trace backend (Tempo / Honeycomb) chosen at V1.5 |
| `MetricsSink` | VictoriaMetrics on Fly (single binary) | Prometheus-compatible; scraped from each Fly machine; cluster vs Grafana Cloud vs Chronosphere choice **deferred to V1.5** |

V1+ exporters live in sibling packages:

- `packages/observability-otel-logs` — OTel log exporter for `Logger`.
- `packages/observability-otel-traces` — OTLP traces exporter for `Tracer`.
- `packages/observability-vm` — VM-specific push backend if we ever push instead of scrape (V1.5 decision).

## Boundary with `packages/telemetry`

| Concern | `packages/observability` (Layers 1 + 2) | `packages/telemetry` (Layer 3) |
|---|---|---|
| Audience | engineers, on-call | PMs, designers, agent platform, end users |
| Data type | logs, spans, metrics | discrete user/agent events; LLM generations |
| Retention | days to weeks (logs); months (metrics) | years |
| Permissions | operator-only | workspace-scoped + role-gated |
| Privacy posture | may transit PII; scrubbed in transport | explicit sensitivity tags; deny-list enforced at SDK boundary |
| Backends | VM, OTel-compatible exporters | self-hosted PostHog (default V1+); Langfuse optional V2+ |
| Joining | `traceId` + `spanId` join with Layer 3 | `userId`, `workspaceId`, `sessionId`, `traceId`, `spanId` |

If a piece of code is wondering which one to use:

- "I want to debug a request" → Layer 2 (`Logger` + `Tracer`).
- "I want to know how often this code path runs" → Layer 1 (`MetricsSink.counter`).
- "I want to know if users save more deals after seeing this UI change" → Layer 3 (`ProductEvents.capture` in `packages/telemetry`).
- "I want to know if this prompt version produces better answers" → Layer 3 (`ProductEvents.generation` in `packages/telemetry`) joined with Layer 3 product events.

## What to instrument

See [`docs/architecture/observability.md`](../../docs/architecture/observability.md) for the full menu. Highlights:

- **Every fetcher request:** adapter, URL, lane (HTTP/browser), throttle state, WAF detection, AIA outcome, duration, status.
- **Every dedup decision:** candidate count, score breakdown, decision, `MergeCandidate` queue depth.
- **Every harness turn:** harness ID, session ID, workspaceId, skill/task, model, prompt version, token usage, cost, tool calls, validation result. (The harness session also emits a Layer 3 `agent.session_started` / `_completed` event.)
- **Every wiki maintainer page write:** workspaceId, path, sha256, source artifact ID, maintainer version.
- **Every queue job:** name, payload size, duration, retries, outcome.

## Default fields on every log

`workspaceId`, `userId`, `traceId`, `spanId`, `service`, `version`, `runtime: 'workers' | 'node'`.

These propagate via `Logger.child()` so context flows through nested calls. They match the Layer 3 identity model so cross-layer joins work.

## Metric naming convention

`clearbolt_<subsystem>_<unit>_<aggregation>` — examples:

- `clearbolt_fetch_request_duration_seconds` (histogram)
- `clearbolt_fetch_request_total` (counter; labels: `adapter`, `lane`, `outcome`)
- `clearbolt_dedup_decision_total` (counter; labels: `decision`, `adapter`)
- `clearbolt_harness_session_cost_usd_total` (counter; labels: `model`, `task`)
- `clearbolt_queue_job_duration_seconds` (histogram; labels: `queue`, `outcome`)
- `clearbolt_ai_token_total` (counter; labels: `model`, `direction` (in/out))

Cardinality discipline: never label by `workspaceId` or `userId` directly. Use bucketed labels (`workspace_size_bucket`, `user_role`).

## Validation criteria

### Functional
- **Given** a `Logger` instance, **when** `child({ traceId: 't1' })` is called and the resulting logger logs a message, **then** the log line includes `traceId: 't1'`. Coverage: unit. Test: `packages/observability/tests/logger.test.ts::child_propagates_fields`.
- **Given** a noop `MetricsSink`, **when** any method is called, **then** it returns successfully without side effects. Coverage: unit. Test: `packages/observability/tests/noop-metrics.test.ts::no_throws`.
- **Given** a `vm-metrics` `MetricsSink`, **when** `counter('clearbolt_fetch_request_total', 1, { adapter: 'bizbuysell' })` is called and `toPrometheusText()` is invoked, **then** the output contains a line `clearbolt_fetch_request_total{adapter="bizbuysell"} 1`. Coverage: unit. Test: `packages/observability/tests/vm-metrics-format.test.ts::counter_renders_prometheus_format`.
- **Given** a CLI run with `CLEARBOLT_METRICS_VM_URL=http://localhost:8428` and the docker-compose VM container running, **when** the run completes, **then** at least one `clearbolt_fetch_request_total` series appears in VM via `curl http://localhost:8428/api/v1/query?query=clearbolt_fetch_request_total`. Coverage: smoke. Test: `apps/cli/tests/metrics-endpoint.smoke.test.ts::vm_scrapes_cli_metrics` (V0).

### Non-functional
- **Given** the V1+ OTel tracer with an OTLP exporter, **when** a span ends, **then** it appears at the configured backend within 30 seconds. Coverage: integration. Test: `packages/observability-otel-traces/tests/exporter-roundtrip.test.ts` (TBD V1).
- **Given** the V1+ VM backend on Fly, **when** measured over a rolling 7-day window, **then** scrape success rate is ≥ 99.5% and ingest lag p95 is < 30s. Coverage: smoke (production telemetry). Test: `scripts/telemetry-health.mjs::vm_scrape_success_995pct` (TBD V1).

### Failure modes
- **Given** a `Logger` and a `Tracer` with the OTel exporter unreachable, **when** logs and spans are emitted, **then** the application continues running and dropped exports are accounted for via a `clearbolt_observability_export_drop_total` counter. Coverage: integration. Test: `packages/observability-otel-traces/tests/exporter-degraded.test.ts` (TBD V1).
- **Given** a `MetricsSink` consumer that calls `histogram` 10,000 times in a tight loop, **when** the loop completes, **then** all 10k values are recorded and the call adds < 100ms total overhead. Coverage: smoke. Test: `packages/observability/tests/vm-metrics-throughput.test.ts` (TBD V1).

### Boundary
- **Given** any property key on `packages/telemetry`'s sensitive-field deny-list, **when** an attempt is made to log it via `Logger.info(msg, { recipientEmail: 'a@b.c' })`, **then** the field is redacted in the output (replaced with `[REDACTED]`). Coverage: unit. Test: `packages/observability/tests/logger-redaction.test.ts` (TBD V1).
- **Given** a `MetricsSink` call, **when** any label value contains a `workspaceId` or `userId`, **then** the call is rejected (or the label is bucketed) to enforce cardinality discipline. Coverage: unit. Test: `packages/observability/tests/cardinality-guard.test.ts` (TBD V1).

## Counter-examples

- This package does **not** capture product events. Use `packages/telemetry`.
- This package does **not** capture LLM-generation events for product-quality analysis. The `harness.session` span lives here (Layer 2); the corresponding `agent.llm_called` event lives in `packages/telemetry` (Layer 3).
- `Logger` does **not** transit raw deal data, capture content, or wiki bodies. Reference them by ID; the body lives in `EvidenceStore` or `WikiStore`.
- `MetricsSink` does **not** carry textual payloads. Use `Logger` for that.

## Open questions

- [ ] V1.5: final OTel log + trace backend choice (Loki / Tempo / Honeycomb / Datadog). Resolved by V1.5 cost + DX review.
- [ ] V1.5: final VM topology (single VM, cluster, Grafana Cloud, Chronosphere). Resolved when we have ~30 days of V1 signal volume.

## ADRs

- [ADR 0014 — Telemetry stack](../../docs/decisions/0014-telemetry-stack.md)
- [ADR 0006 — Pluggable everything](../../docs/decisions/0006-pluggable-everything.md)
- [ADR 0010 — Hybrid Cloudflare + Fly.io deployment](../../docs/decisions/0010-deployment-hybrid-cf-fly.md)
- [ADR 0015 — Specs include validation criteria](../../docs/decisions/0015-specs-include-validation-criteria.md)
