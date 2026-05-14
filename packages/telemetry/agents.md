# `packages/telemetry`

> Runtime: **both**.
>
> V0: docs only. V1+ scaffold.

Owns the `ProductEvents` contract — Layer 3 of the telemetry stack ([docs/architecture/telemetry.md](../../docs/architecture/telemetry.md)). Distinct from `packages/observability` (Layers 1 + 2: ops metrics, logs, traces). Distinct in audience (PMs / designers / agent platform team / end users), retention (long), and privacy posture (workspace-private by default; explicit consent for cross-workspace aggregation).

ADR: [0014 — Telemetry stack](../../docs/decisions/0014-telemetry-stack.md).

## Why this is its own package

`packages/observability` serves engineers debugging the system. Its data is ephemeral, high-cardinality on `traceId`, and not safe to expose to end users. Mixing product-event ingest into the same contract would muddy:

- Retention (logs roll over in days; product events live for years).
- Permissions (logs are operator-only; product events feed end-user dashboards).
- Privacy (logs may contain PII transiently; product events are explicitly scrubbed and consent-gated).
- Backends (PostHog ≠ Loki; the storage and query plane is different).

Keeping `ProductEvents` in its own package means Layer 3 backends can ship independently and consumers cannot accidentally route product events through the operational logger.

## Contracts

```ts
interface ProductEvents {
  identify(userId: string, traits?: Record<string, unknown>): Promise<void>;
  group(workspaceId: string, traits?: Record<string, unknown>): Promise<void>;

  capture(event: ProductEvent): Promise<void>;
  captureBatch(events: ProductEvent[]): Promise<void>;

  // Agent-run / LLM observability
  generation(gen: GenerationEvent): Promise<void>;

  // Feature flags read-side (PostHog or any provider)
  isFeatureEnabled(key: string, ctx: FlagContext): Promise<boolean>;
  getFeaturePayload<T = unknown>(key: string, ctx: FlagContext): Promise<T | null>;

  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

interface ProductEvent {
  name: string;                 // 'listing.saved', 'wiki.query_asked', ...
  workspaceId: string;
  userId: string;               // 'system' for background jobs
  sessionId?: string;           // browser session OR harness session
  traceId?: string;             // joins to Layer 2 spans
  spanId?: string;
  timestamp?: Date;
  properties?: Record<string, unknown>;
  // Sensitivity tag is structural, not a property; enforced by the contract.
  sensitivity: 'public' | 'workspace-private' | 'sensitive-pii' | 'sensitive-financial';
}

interface GenerationEvent {
  workspaceId: string;
  userId: string;
  sessionId: string;            // harness session
  traceId?: string;
  spanId?: string;
  model: string;                // 'gpt-4o-mini', 'claude-3-5-sonnet', ...
  promptVersion: string;        // semver-tagged or git-sha
  task: string;                 // 'wiki.ingest', 'dedup.judge', ...
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  cacheHit?: boolean;
  validatorPass?: boolean;
  evalScore?: number;           // optional — set if a judge ran
  toolCalls?: ToolCallSummary[];
}

interface ToolCallSummary {
  tool: string;
  durationMs: number;
  outcome: 'ok' | 'error' | 'timeout';
}

interface FlagContext {
  workspaceId: string;
  userId: string;
  properties?: Record<string, unknown>;
}
```

## Backends

### V0 — `noop`

Default. Returns `void` from every method. Zero deps. Lets V0 code call `events.capture(...)` without changing shape later.

### V0 dev — `console` (optional)

Pretty-prints events to stderr. Useful when iterating on instrumentation locally. Activated via `CLEARBOLT_TELEMETRY_BACKEND=console`.

### V1+ — `posthog`

`packages/telemetry-posthog` (sibling). Self-hosted PostHog on Fly. The default V1+ backend. Implements every method above. Uses PostHog's Node SDK on Fly and PostHog's JS SDK in `apps/web`.

Identity: PostHog `distinct_id` = `userId`; `groups: { workspace: workspaceId }`. Event sensitivity is enforced at the SDK boundary — a `sensitive-financial` event refuses to send if it carries any property whose key is on the sensitive-field deny-list (financial profile fields, contact PII, capture content, wiki body).

### V2+ optional — `langfuse` (compose, do not replace)

`packages/telemetry-langfuse` (sibling). Adds deeper agent-trace shape (span hierarchy beyond 3 levels, per-tool-call cost breakdown, structured eval datasets). Composes alongside PostHog, not replaces it: an app binds both backends and the `MultiBackend` adapter fans events out (product events to PostHog only; generation events to both).

We do not ship Langfuse in V1 unless a measured agent-platform need triggers it (per ADR 0014 falsifiability criteria).

## Events catalog (V1 starter set)

The canonical list lives in [docs/architecture/telemetry.md §Events catalog](../../docs/architecture/telemetry.md#events-catalog-v1-starter-set). Per-event details (`name`, `properties` shape, `sensitivity` tag, sample event) live in `events.ts` once the package is scaffolded in V1.

## Privacy posture

- **Default:** workspace-private. PostHog data partitioned per workspace at the team level.
- **Cross-workspace product analytics:** opt-in (default opt-in for new workspaces with clear copy; workspace owners can opt out at any time). Computed by a nightly de-identification pipeline in `services/deidentify` (V1.5).
- **Sensitive fields:** never leave the workspace. Buyer financial values, recipient PII, capture content, wiki body. The contract refuses to send events tagged `sensitive-financial` or `sensitive-pii` if the active backend is configured for cross-workspace mode.
- **Data subject rights:** delete-by-userId implemented via PostHog's `delete person` API; per-userId logs scrubbed via the V1.5 DSR job.

## Validation criteria

### Functional
- **Given** a `noop` backend (V0 default), **when** any method is called, **then** it returns successfully without side effects. Coverage: unit. Test: `packages/telemetry/tests/noop-backend.test.ts` (TBD V1 scaffold).
- **Given** a `posthog` backend bound and PostHog reachable, **when** `capture({ name: 'test.event', workspaceId, userId, sensitivity: 'public' })` is called, **then** within 5 seconds the event appears in PostHog under that workspace's project. Coverage: integration. Test: `packages/telemetry-posthog/tests/capture-end-to-end.test.ts` (TBD V1).
- **Given** a `posthog` backend, **when** `generation({...})` is called for a wiki-maintainer LLM call, **then** PostHog records it as an LLM generation event with `promptVersion`, `model`, `costUsd`, and links it to the `traceId` provided. Coverage: integration. Test: `packages/telemetry-posthog/tests/generation-event.test.ts` (TBD V1).

### Non-functional
- **Given** the production V1 backend, **when** measured over 7 days, **then** event delivery success rate is ≥ 99%. Coverage: smoke (production telemetry on telemetry). Test: `scripts/telemetry-health.mjs::posthog_delivery_rate_99pct` (TBD V1).
- **Given** the V1 web SDK, **when** PostHog is unreachable for 5 minutes, **then** events buffer locally up to 10 MB / 1000 events per browser tab and flush on reconnect with no events dropped silently. Coverage: integration. Test: `packages/telemetry/tests/buffer-and-flush.test.ts` (TBD V1).

### Failure modes
- **Given** a `posthog` backend in cross-workspace mode, **when** `capture(event)` is called with `sensitivity: 'sensitive-financial'`, **then** the call throws `SensitivityViolation` and emits no event. Coverage: unit. Test: `packages/telemetry-posthog/tests/sensitivity-guard.test.ts` (TBD V1).
- **Given** a `posthog` backend, **when** `capture(event)` is called with a property key on the sensitive-field deny-list (e.g., `recipientEmail`, `assetsTotalUsd`, `wikiBody`), **then** the call throws `SensitivityViolation` regardless of the event's `sensitivity` tag (defense-in-depth). Coverage: property test. Test: `packages/telemetry-posthog/tests/deny-list.property.test.ts` (TBD V1).

### Privacy
- **Given** a workspace owner has opted out of cross-workspace aggregation, **when** the nightly de-identify pipeline runs, **then** their workspace's events are not present in the anonymous project. Coverage: integration. Test: `services/deidentify/tests/opt-out-honored.test.ts` (TBD V1.5).
- **Given** a CCPA/GDPR delete-by-userId request, **when** the DSR job runs, **then** all PostHog events for that userId are removed within 30 days. Coverage: integration. Test: `services/dsr/tests/posthog-delete-userId.test.ts` (TBD V1.5).

### Identity
- **Given** an event with both `traceId` and `sessionId`, **when** the event is captured, **then** PostHog stores both as searchable properties and the corresponding Layer 2 span carries the same identifiers (asserted by reading both layers and joining on `traceId`). Coverage: integration. Test: `packages/telemetry-posthog/tests/cross-layer-identity.test.ts` (TBD V1).

## Counter-examples

- This package does **not** carry operational logs. Use `packages/observability` `Logger` for that.
- This package does **not** carry operational metrics. Use `packages/observability` `MetricsSink` for that.
- This package does **not** carry stack traces or exception details. Those go through `Tracer.recordException` (Layer 2). A product event saying "the wiki query errored" is fine; the stack lives in Layer 2.
- This package does **not** capture raw deal data, capture content, or wiki bodies. It captures events about those artifacts and references them by ID.

## Open questions

- [ ] V1.5: per-workspace PostHog "team" (cleaner privacy, more ops) vs single instance with per-workspace properties (simpler, weaker boundary). Resolved when we have V1 cross-workspace query needs documented.
- [ ] V1: scaffold this package as `packages/telemetry` with `noop` baked in, plus `packages/telemetry-posthog` as a sibling — same as the storage-r2 pattern.
- [ ] V2: do we add Langfuse? Decision deferred to ADR 0014 falsifiability triggers.

## ADRs

- [ADR 0014 — Telemetry stack](../../docs/decisions/0014-telemetry-stack.md)
- [ADR 0006 — Pluggable everything](../../docs/decisions/0006-pluggable-everything.md) (this package follows the contract + sibling-backend pattern)
- [ADR 0012 — Workspaces as tenant boundary](../../docs/decisions/0012-multi-tenancy-workspace-as-tenant.md) (privacy boundary inherits)
- [ADR 0015 — Specs include validation criteria](../../docs/decisions/0015-specs-include-validation-criteria.md)
