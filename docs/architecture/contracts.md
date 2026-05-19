# Contracts inventory

The canonical reference for every interface in Clearbolt. Per-package `agents.md` files repeat the relevant slice and link back here.

## Conventions

- **Owner**: the package that defines the contract.
- **Backends**: implementations that satisfy the contract, with the phase that introduces each.
- **Runtime**: where each backend can run — `node` (Fly.io), `workers` (CF Workers), or `both`.
- **Conformance suite**: the test suite every backend must pass. Lives in the contract's owner package under `src/conformance/`. Per [principle 5](principles.md#5-specs-include-validation-criteria-negotiated-before-commit), a backend that does not pass the conformance suite does not ship.
- **Phase**: V0 (local dev only), V1 (production), V2+ (later).

## Identity and tenancy (cross-cutting)

Workspace-scoped contract surfaces take **`workspaceId`** from validated auth ([ADR 0012](../decisions/0012-multi-tenancy-workspace-as-tenant.md), [`packages/auth/agents.md`](../../packages/auth/agents.md)).

**Per-user** ownership and attribution (saved market queries, dealbox / anti-dealbox, capture attribution, user-private artifacts under a workspace) use better-auth **`User.id`**, exposed as **`userId`** in `ClearboltClaims` — **never** email or another login identifier. Users can change email without rewriting query or pipeline rows; invites still use email only for delivery until acceptance binds to `User.id`. Product and table shapes: [teams-projects-dealbox.md](teams-projects-dealbox.md). R2 key prefixes and Neon column rules: [storage.md](storage.md), [`packages/storage/agents.md`](../../packages/storage/agents.md), [`packages/storage-r2/agents.md`](../../packages/storage-r2/agents.md).

## Storage

### EvidenceStore

Raw blobs (HTML, JSON, PDFs, screenshots, audio, transcript markdown, prompt/response artifacts).

- Owner: `packages/storage`
- API: `put(payload, meta) -> { key, sha256 }`, `get(key) -> stream`, `exists(sha256)`, `head(key)`.
- Backends:
  - V0 disk (baked into `packages/storage`) — runtime: `node`.
  - V1+ `packages/storage-r2` (Cloudflare R2 / S3-compatible) — runtime: `both`.
- Conformance suite: `packages/storage/src/conformance/evidence-store.suite.ts` (TBD V0).

### MetadataStore

Structured records and indexes. Plain typed CRUD, no blobs.

- Owner: `packages/storage`
- API: workspaces, source records, canonical deals, brokers, captures, wiki page index, dedup index, audit log, etc.
- Backends:
  - V0 disk JSON/JSONL (baked into `packages/storage`) — runtime: `node`.
  - V1+ `packages/storage-neon` (Neon Postgres + Prisma v7; **node `pg` driver today**; CF HTTP driver planned) — runtime: `both`. V1 walking skeleton uses JSONB payload tables (`source_records`, `canonical_deals`, …) mirroring disk layout; team pipeline tables (`workspace_projects`, `user_market_queries`, …) are relational columns.
- Conformance suite: `packages/storage/src/conformance/metadata-store.suite.ts` — invoked from `packages/storage/tests/disk-metadata-store.test.ts` (disk) and `packages/storage-neon/tests/conformance.test.ts` (Neon when `DATABASE_URL` set). Sub-stores each have sub-suites invoked from the parent.

### DealSearchIndex (lexical, shared cache)

Postgres FTS over canonical deals — not a separate package contract; implemented in `packages/storage-neon` (`deal_search_index` table, migration `20260519000000_deal_search_fts`).

- Owner: `packages/storage-neon` (query/index helpers); DDL in `packages/db`.
- API: `upsertDealSearchIndex`, `searchDealSearchIndex`, `searchDealSearchIndexOr`, `reindexAllDealSearch`.
- Query preparation (token expansion, relaxed FTS strings): `packages/search` (`prepareSearchQuery`, optional LLM expand).
- Backends:
  - V0 web/CLI without DB: in-memory filter on loaded deals (`apps/web/lib/deals.ts`).
  - V1+ Neon Postgres FTS + `pg_trgm` — runtime: `node` today; CF read path planned.
- Tests: `packages/search/tests/query-prepare.test.ts`; Neon FTS integration tests TBD.

### WikiStore

Per-workspace, per-deal markdown plus shared entity pages.

- Owner: `packages/storage`
- API: read/write markdown pages by workspace + path; list pages; snapshot/version operations.
- Backends:
  - V0 `packages/wiki-fs` (disk, optional `git init`) — runtime: `node`.
  - V1+ `packages/wiki-r2` (markdown on R2 with content-addressed snapshots; index in `MetadataStore`) — runtime: `both`.
- Conformance suite: `packages/storage/src/conformance/wiki.suite.ts`. (`assertWikiStoreConformance` exported from `@clearbolt/storage/conformance`.)

## Ingestion (scraper)

### Fetcher

- Owner: `packages/scraper`
- API: `fetch(request) -> response` with hooks for headers, throttling, WAF detection, retry/escalation policy.
- Backends:
  - `HttpFetcher` (got + AIA + browser-like headers) — V0 — runtime: `node`.
  - `BrowserFetcher` (Playwright) — V0/V1 — runtime: `node`.
  - `MockFetcher` (tests) — V0 — runtime: `both`.
  - `ApifyFetcher` — V1+ optional fallback per [ADR 0013](../decisions/0013-apify-as-optional-fallback.md) — runtime: `node`.
- Conformance suite: `packages/scraper/src/conformance/fetcher.suite.ts` (TBD V0).

### ThrottleManager

- Owner: `packages/scraper`
- API: per-domain admission control with separate pools for HTTP and browser.
- Backends:
  - V0 in-process AIMD with persisted state — runtime: `node`.
  - Pluggable for token-bucket / fixed-rate variants.
- Conformance suite: `packages/scraper/src/conformance/throttle-manager.suite.ts` (TBD V0).

### WafDetector

- Owner: `packages/scraper`
- API: classify response into `ok | challenge | block | rate_limited` and emit escalation hints.
- Backends:
  - V0 heuristic rule set covering Akamai, Cloudflare, PerimeterX — runtime: `node`.
  - Pluggable rule packs per WAF family.
- Conformance suite: `packages/scraper/src/conformance/waf-detector.suite.ts` + golden-set fixtures under `packages/scraper/tests/fixtures/waf/<family>/` (TBD V0).

### ProxyPool

- Owner: `packages/scraper`
- API: lease/release a proxy per request; rotation policy on block.
- Backends:
  - V0 direct (default) — runtime: `node`.
  - V0/V1 optional: rotating residential/datacenter via env + proxy endpoints file (`rotating-proxy-fetcher.ts`, `CLEARBOLT_PROXY_*` in `.env.example`).
- Conformance suite: `packages/scraper/src/conformance/proxy-pool.suite.ts` (TBD V1).

### Adapter

- Owner: `packages/scraper/adapters/<source>/`
- API: `parseSearchUrl`, `discoverListingRefs`, `fetchListingDetail`, `extractBrokerLinks`.
- Backends: one per site (bizbuysell, bizquest, businessbroker, businessesforsale, loopnet, bizben, dealstream).
- Conformance suite: `packages/scraper/src/conformance/adapter.suite.ts` (TBD V0) — every adapter invokes it from its own test file with adapter-specific fixtures under `packages/scraper/adapters/<source>/tests/fixtures/`.

### Scraper HTTP service (V1 dev / Fly)

Remote Playwright + scrape orchestration so Next.js and other clients do not spawn browsers in-process.

- Owner: `apps/scraper-service`
- API: `GET /health`; `POST /v1/bizbuysell/scrape` and `POST /v1/bizbuysell/catalog-scrape` (NDJSON progress + `result`).
- Auth: optional `Authorization: Bearer` when `CLEARBOLT_SCRAPER_SERVICE_SECRET` is set.
- Runtime: `node` (Fly.io prod; local `pnpm scraper-service:dev`).
- Spec: [`apps/scraper-service/agents.md`](../../apps/scraper-service/agents.md).

## Capture (universal clipper)

### HtmlToMarkdown

- Owner: `packages/capture`
- API: `convert(rawHtml, opts?) -> markdown`.
- Backends:
  - V0 default `defuddle` — runtime: `both`.
  - Pluggable Readability+Turndown, Jina Reader, custom.
- Conformance suite: `packages/capture/src/conformance/html-to-markdown.suite.ts` + golden-set fixtures per host under `packages/capture/tests/fixtures/<host>/{input.html,expected.md}` (TBD V1).

### HostHeuristic

- Owner: `packages/capture`
- API: per-host extractor that proposes structured fields from a captured page.
- Backends: registry of per-host extractors (Axial, ChatGPT, Claude.ai, Gemini, Perplexity, BizBuySell detail page, generic fallback).
- Conformance suite: `packages/capture/src/conformance/host-heuristic.suite.ts` (TBD V1) — every heuristic invokes it with per-host golden-set fixtures.

## Transcripts

### Transcriber

- Owner: `packages/transcribe`
- API: `transcribe({ audioRef | url, hint }) -> { transcriptMarkdown, segments, language, confidence, costUsd }`.
- Backends (tiered fallback policy in [transcripts.md](transcripts.md)):
  - `YouTubeTranscriptApi` — V1 — runtime: `both`.
  - `WhisperLocal` (ffmpeg + faster-whisper) — V1 — runtime: `node` (Fly only; native binaries do not run on Workers).
  - `GeminiAudio` — V1 — runtime: `both`.
  - `OpenAIWhisperApi` — V1 — runtime: `both`.
- Conformance suite: `packages/transcribe/src/conformance/transcriber.suite.ts` (TBD V1).

## AI

### Embedder

- Owner: `packages/ai`
- API: `embed(texts) -> vectors`.
- Backends:
  - V1 OpenAI default — runtime: `both`.
  - Pluggable Cohere, Workers AI, others — runtime: depends on provider.
- Conformance suite: `packages/ai/src/conformance/embedder.suite.ts` (TBD V1).

### ModelProvider

- Owner: `packages/ai`
- Vercel AI SDK abstracts the provider; `packages/ai` adds Clearbolt-specific routing (model per call type: extraction, normalization, wiki maintain, ranking) and AI Gateway integration for caching/observability.
- Runtime: `both`.
- Conformance suite: `packages/ai/src/conformance/model-provider.suite.ts` (TBD V1).

## Dedup

### DedupKeyer

- Owner: `packages/dedup`
- API: `keys(sourceRecord) -> DedupKey[]`.
- Backends: per-source key strategies; pluggable.
- Conformance suite: `packages/dedup/src/conformance/dedup-keyer.suite.ts` (TBD V0).

### Scorer

- Owner: `packages/dedup`
- **Compositional**: a top-level score is the weighted sum of contributions from registered contributors.
- V0 contributors (deterministic + lexical): `deterministic`, `lexical`, `numeric`, `geo`.
- V1+ contributor: `vector` (added without rewriting prior contributors per [ADR 0011](../decisions/0011-vector-pgvector-on-neon-v1.md)).
- Sub-threshold candidate pairs are persisted as `MergeCandidate`s so V1's vector pass can re-evaluate without a full re-scan.
- Conformance suite: `packages/dedup/src/conformance/scorer.suite.ts` + golden-set fixtures `packages/dedup/tests/fixtures/known-pairs.ts` (TBD V0).

### MergeDecider

- Owner: `packages/dedup`
- API: given a scored pair, decide `auto_merge | review | new`.
- Backends: pluggable threshold/policy.
- Conformance suite: `packages/dedup/src/conformance/merge-decider.suite.ts` (TBD V0).

## Agent harness

### Harness, Session, Task, Skill, Tool

- Owner: `packages/agents`
- Public surface mirrors Flue (see [harness.md](harness.md)).
- Built on top of: `Sandbox`, `SkillsLoader`, `MCPClient`, `ResultValidator`, `SessionStore`, `ModelProvider`.
- Runtime: `both`.
- Conformance suite: `packages/agents/src/conformance/harness.suite.ts` (TBD V1) — covers public-surface contract.

### Sandbox

- Owner: `packages/agents-sandboxes`
- Backends:
  - `virtual` (in-process, just-bash-like) — V0/V1 — runtime: `both`.
  - `local-node` — V1 — runtime: `node`.
  - `daytona`, `e2b`, `vercel-sandbox` — V2+ — runtime: `node`.
- Conformance suite: `packages/agents-sandboxes/src/conformance/sandbox.suite.ts` (TBD V1).

### SkillsLoader

- Owner: `packages/agents`
- Backends:
  - V0 file-based (`.agents/skills/<name>.md` from CWD) — runtime: `both`.
  - V1+ optional DB-backed registry.
- Conformance suite: `packages/agents/src/conformance/skills-loader.suite.ts` (TBD V1).

### MCPClient

- Owner: `packages/agents`
- Wraps the public MCP spec (`connectMcpServer(name, { url, headers, transport })`).
- Runtime: `both`.
- Conformance suite: `packages/agents/src/conformance/mcp-client.suite.ts` (TBD V1).

### ResultValidator

- Owner: `packages/agents`
- Accepts **Zod** schemas by default (`z.ZodTypeAny`).
- Runtime: `both`.
- Conformance suite: `packages/agents/src/conformance/result-validator.suite.ts` (TBD V1).

### SessionStore

- Owner: `packages/agents`
- Backends:
  - V0 in-memory — runtime: `node`.
  - V1+ Postgres-backed (workspace-scoped) — runtime: `both`.
  - V2+ Cloudflare Durable Objects adapter (if/when we want CF-side sessions).
- Conformance suite: `packages/agents/src/conformance/session-store.suite.ts` (TBD V1).

## Auth

### AuthProvider

- Owner: `packages/auth`
- Wraps better-auth (`createClearboltAuth`, `organization` + `emailOTP` plugins, optional Google/GitHub OAuth).
- Workspaces/orgs as tenant boundary; target claim shape `ClearboltClaims` (`userId`, `workspaceId`, `workspaceRole`).
- **Shipped:** Next.js route handler + web middleware via `get-session`; `requireAuth` / `@clearbolt/auth/workers` | `/node` split **TBD**.
- Pluggable social providers.
- Runtime: `both` (target); Node handler wired in [`apps/web`](../../apps/web/agents.md).
- Conformance suite: `packages/auth/src/conformance/auth-provider.suite.ts` (TBD V1) — plus `packages/auth/tests/exports.test.ts`, `user-id.test.ts`, and cross-runtime token test `packages/auth/tests/cross-runtime-token-validation.test.ts` (TBD V1).

## Platform plumbing

### Queue / Scheduler

- Owner: `packages/queue`
- Backends:
  - V0 in-memory + node-cron — runtime: `node`.
  - V1+ pg-boss on Fly — runtime: `node`.
  - V2+ Cloudflare Queues adapter — runtime: `workers`.
- Conformance suite: `packages/queue/src/conformance/queue.suite.ts` (TBD V1).

### SearchIndex (BM25)

- Owner: `packages/search` (contract); **Postgres FTS execution** in `packages/storage-neon` (`deal_search_index`).
- Backends:
  - V0 / no DB: in-memory token filter on loaded deals — runtime: `node`.
  - V1+ (partial): Postgres FTS + `pg_trgm` on Neon — runtime: `node` today; CF HTTP driver planned.
  - Query prep only (always): `prepareSearchQuery`, optional `expandSearchQueryWithLlm` in `packages/search`.
- Conformance suite: `packages/search/src/conformance/search-index.suite.ts` (TBD V1). Query prep: `packages/search/tests/query-prepare.test.ts`.

### VectorStore

- Owner: `packages/search`
- Backends:
  - V0 none (deferred per [ADR 0011](../decisions/0011-vector-pgvector-on-neon-v1.md)).
  - V1+ pgvector on Neon — runtime: `both`.
  - Future: dedicated vector DB (Vectorize / Qdrant / Pinecone) if scaling demands.
- Conformance suite: `packages/search/src/conformance/vector-store.suite.ts` (TBD V1).

## Notifications (V1+)

### Notifier

- Owner: `packages/notifications`
- Backends: email (Postmark/SES/Mailgun), Slack, webhook channels — runtime: `both`.
- Conformance suite: `packages/notifications/src/conformance/notifier.suite.ts` (TBD V1).

## Observability (Layers 1 + 2)

### Logger

- Owner: `packages/observability`
- Backends:
  - V0 pino → stderr — runtime: `node`.
  - V1+ pino → stdout + OTel log exporter sibling — runtime: `both`. Final OTel log backend (Loki / Datadog / Honeycomb) chosen at V1.5.
- Conformance suite: `packages/observability/src/conformance/logger.suite.ts` (TBD V0).

### Tracer

- Owner: `packages/observability`
- Backends:
  - V0 noop (or in-memory span buffer) — runtime: `both`.
  - V1+ OpenTelemetry SDK + OTLP exporter — runtime: `both`. Final trace backend (Tempo / Honeycomb) chosen at V1.5.
- Conformance suite: `packages/observability/src/conformance/tracer.suite.ts` (TBD V0).

### MetricsSink

- Owner: `packages/observability`
- Backends:
  - V0 noop (default) — runtime: `both`.
  - V0 dev `vm-metrics` (Prometheus-text endpoint, opt-in via `CLEARBOLT_METRICS_VM_URL`) — runtime: `node`.
  - V1+ VictoriaMetrics on Fly (single binary; cluster vs Grafana Cloud vs Chronosphere deferred to V1.5) — runtime: `both`.
- Conformance suite: `packages/observability/src/conformance/metrics-sink.suite.ts` (TBD V0).

## Telemetry (Layer 3)

### ProductEvents

- Owner: `packages/telemetry`
- API: `identify`, `group`, `capture`, `captureBatch`, `generation`, `isFeatureEnabled`, `getFeaturePayload`, `flush`, `shutdown`.
- Backends:
  - V0 `noop` (default) — runtime: `both`.
  - V0 dev `console` (opt-in via `CLEARBOLT_TELEMETRY_BACKEND=console`) — runtime: `node`.
  - V1+ `packages/telemetry-posthog` (self-hosted PostHog on Fly) — runtime: `both`.
  - V2+ optional `packages/telemetry-langfuse` (compose, do not replace) — runtime: `both`.
- Conformance suite: `packages/telemetry/src/conformance/product-events.suite.ts` (TBD V1).
- ADR: [0014](../decisions/0014-telemetry-stack.md).

## Validation criteria

This inventory itself is a spec — its correctness is the foundation of "pluggable everything."

### Functional
- **Given** any contract listed above, **when** `pnpm lint:specs` runs, **then** the contract has a `Conformance suite:` line pointing to a real file path (or marked TBD with the phase). Coverage: smoke. Test: `scripts/lint-specs.mjs::contract_has_conformance_suite_cell` (V0 advisory; V1 enforced).
- **Given** any backend package in the workspace, **when** its tests run, **then** at least one test invokes the conformance suite from its contract's owner package. Coverage: smoke. Test: `scripts/lint-specs.mjs::backend_invokes_conformance_suite` (TBD V1).
- **Given** any contract, **when** read, **then** every backend listed has a `runtime` annotation (`node`, `workers`, `both`, or `depends`). Coverage: lint. Test: `scripts/lint-specs.mjs::backend_has_runtime_annotation` (TBD V1).

### Drift
- **Given** any sibling backend package added to the workspace, **when** the contracts inventory is updated, **then** the new backend appears under its contract's section in the same PR. Coverage: PR review checklist + lint over `packages/` directory vs this file's content. Test: `scripts/lint-specs.mjs::contracts_inventory_lists_all_backends` (TBD V1).
- **Given** any contract whose API signature changes, **when** the change is reviewed, **then** the conformance suite is updated in the same PR (otherwise existing backends silently lose conformance). Coverage: PR review.

### Phase markers
- **Given** any contract, **when** read, **then** every backend has a phase marker (`V0`, `V1`, `V2+`). Coverage: lint. Test: `scripts/lint-specs.mjs::backend_has_phase_annotation` (TBD V1).

### Identity and tenant keys
- **Given** any API or `MetadataStore` path that persists rows "per user" inside a workspace, **when** a row is written, **then** the owner column (or R2 path segment for user-private blobs) is internal `userId` / `User.id` from auth, not email. Coverage: integration. Test: `packages/storage-neon/tests/user-scoped-owner-is-user-id.test.ts`.
- **Given** a valid session per the auth contract (`ClearboltClaims`), **when** the same account changes primary email in better-auth, **then** `userId` is unchanged and user-scoped data still resolves to that account. Coverage: integration. Test: `packages/auth/tests/email-change-preserves-user-scoped-rows.test.ts`.
