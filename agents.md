# Clearbolt — agent & contributor guide

This is the slim index. Read [docs/](docs/) for substance.

> **File convention:** Many agent runtimes look for `AGENTS.md` (uppercase) at repo root. Mirror this file as `AGENTS.md` (or symlink) once we settle on the canonical name. Until then, treat `agents.md` as authoritative.

## Mission

**Clearbolt helps ETA searchers find, organize, and evaluate acquisition opportunities.** [docs/product/mission.md](docs/product/mission.md).

## How to read these docs

```
docs/
  product/         — what Clearbolt is and what surfaces it ships
  architecture/    — how it works (principles, contracts, deployment, per-system designs)
  phases/          — V0 / V1 / V2 / V3+ scope
  operations/      — running it (cost, envs, metrics, failure modes, audit)
  decisions/       — ADRs (resolved) + open.md (in flight)
packages/          — code packages, each with its own agents.md (contracts + backends)
apps/              — applications (extension, web app)
```

### Architecture (start here)

- [docs/architecture/principles.md](docs/architecture/principles.md) — the four-principle spine.
- [docs/architecture/contracts.md](docs/architecture/contracts.md) — every interface and its current/planned backends.
- [docs/architecture/deployment.md](docs/architecture/deployment.md) — hybrid CF + Fly topology.
- [docs/architecture/data-model.md](docs/architecture/data-model.md) — entities, relationships, Prisma v7 sketch.
- [docs/architecture/storage.md](docs/architecture/storage.md) — `EvidenceStore` / `MetadataStore` / `WikiStore`.
- [docs/architecture/dedup.md](docs/architecture/dedup.md) — compositional `Scorer`, V0 deterministic + lexical, V1+ vector.
- [docs/architecture/ingestion.md](docs/architecture/ingestion.md) — adapter pattern, freshness, parser drift.
- [docs/architecture/harness.md](docs/architecture/harness.md) — Flue-shaped agent harness contract.
- [docs/architecture/wiki.md](docs/architecture/wiki.md) — Karpathy-style per-deal LLM wiki.
- [docs/architecture/capture.md](docs/architecture/capture.md) — universal clipper pipeline.
- [docs/architecture/transcripts.md](docs/architecture/transcripts.md) — tiered transcript pipeline.
- [docs/architecture/ai-usage.md](docs/architecture/ai-usage.md) — model routing, prompt versioning, evals.
- [docs/architecture/observability.md](docs/architecture/observability.md) — logger / tracer / metrics (Layers 1+2 of telemetry stack).
- [docs/architecture/telemetry.md](docs/architecture/telemetry.md) — product analytics + agent run traces (Layer 3) + admin UI (Layer 4).
- [docs/architecture/testing-strategy.md](docs/architecture/testing-strategy.md) — how validation criteria become tests.
- [docs/architecture/spec-template.md](docs/architecture/spec-template.md) — canonical shape every new spec uses.
- [docs/architecture/security.md](docs/architecture/security.md) — compliance, security posture, multi-tenancy.
- [docs/architecture/api-webhooks.md](docs/architecture/api-webhooks.md) — public API roadmap (V3+).

### Product

- [docs/product/mission.md](docs/product/mission.md)
- [docs/product/personas.md](docs/product/personas.md)
- [docs/product/principles.md](docs/product/principles.md)
- [docs/product/glossary.md](docs/product/glossary.md) — ETA shorthand.
- [docs/product/surfaces.md](docs/product/surfaces.md) — workspaces, onboarding, market definition, ranking, quality-of-deal, saved searches, inbound, documents, comps, notifications, off-market lead management, deal pipeline.
- [docs/product/feedback-personalization.md](docs/product/feedback-personalization.md)

### Phases

- [docs/phases/V0.md](docs/phases/V0.md) — local-dev only, scraper-only walking skeleton.
- [docs/phases/V1.md](docs/phases/V1.md) — production: hybrid CF+Fly, Neon + R2, scraper, dedup, wiki, capture API, transcripts, web app.
- [docs/phases/V2.md](docs/phases/V2.md) — multi-user, browser extension, outreach, comps, container sandboxes.
- [docs/phases/V3-plus.md](docs/phases/V3-plus.md) — provider/deal-team marketplace, public API/webhooks, CRM integrations.

### Operations

- [docs/operations/cost-budgets.md](docs/operations/cost-budgets.md)
- [docs/operations/environments.md](docs/operations/environments.md)
- [docs/operations/success-metrics.md](docs/operations/success-metrics.md)
- [docs/operations/failure-modes.md](docs/operations/failure-modes.md)
- [docs/operations/audit-activity.md](docs/operations/audit-activity.md)
- [docs/operations/dependency-lag.md](docs/operations/dependency-lag.md) — npm release lag (~30 days), Renovate, and lockfile verification.

### Decisions

- [docs/decisions/open.md](docs/decisions/open.md) — open questions / TBDs.
- ADRs: [0001](docs/decisions/0001-storage-split.md) storage split, [0002](docs/decisions/0002-dedup-v0.md) dedup V0, [0003](docs/decisions/0003-multi-source-preservation.md) multi-source preservation, [0004](docs/decisions/0004-extension-universal-user-capture.md) universal user-capture, [0005](docs/decisions/0005-harness-borrow-flue-patterns.md) Flue-shaped harness, [0006](docs/decisions/0006-pluggable-everything.md) pluggable everything, [0007](docs/decisions/0007-per-deal-llm-wiki.md) per-deal LLM wiki, [0008](docs/decisions/0008-html-to-markdown-defuddle.md) Defuddle, [0009](docs/decisions/0009-transcript-tiered-pipeline.md) tiered transcripts, [0010](docs/decisions/0010-deployment-hybrid-cf-fly.md) hybrid CF+Fly, [0011](docs/decisions/0011-vector-pgvector-on-neon-v1.md) pgvector on Neon, [0012](docs/decisions/0012-multi-tenancy-workspace-as-tenant.md) workspace tenant boundary, [0013](docs/decisions/0013-apify-as-optional-fallback.md) Apify optional fallback, [0014](docs/decisions/0014-telemetry-stack.md) telemetry stack (VM + OTel + self-hosted PostHog + admin UI), [0015](docs/decisions/0015-specs-include-validation-criteria.md) specs include validation criteria.

## Architectural principles digest

Five principles drive every layout decision. Full text in [docs/architecture/principles.md](docs/architecture/principles.md).

1. **Pluggable everything.** Each domain package owns contracts and ships a V0 default. Heavier backends are sibling packages. Application code depends on contracts, not implementations.
2. **Flue-shaped agent harness, custom runtime.** [`packages/agents`](packages/agents/agents.md) public surface mirrors [Flue](https://github.com/withastro/flue); internals are ours so multi-tenant / pluggable concerns are first-class. "Steal periodically" = adapt Flue features into our internals while keeping the public surface stable.
3. **Karpathy-style per-deal LLM wiki.** Raw sources stay immutable; the wiki maintainer agent compiles them into per-workspace, per-deal markdown plus a shared cross-deal entity layer. `AGENTS.md` is the schema.
4. **Hybrid Cloudflare + Fly.io deployment.** CF Pages + Workers for client-facing edge; Fly.io for heavy backend (scraper, transcribe, agent runners, queue, write API); Neon (Postgres + pgvector) and R2 as shared truth; better-auth for tenant-aware identity.
5. **Specs include validation criteria, negotiated before commit.** Every spec — `agents.md`, ADR, contract, design doc, phase doc — includes a `## Validation criteria` section listing concrete, testable assertions. Implementation order: criteria → failing tests → implementation → green → commit. Canonical shape in [spec-template.md](docs/architecture/spec-template.md); mapping to test types in [testing-strategy.md](docs/architecture/testing-strategy.md). Enforced by `pnpm lint:specs`.

## Target stack

| Layer | Direction |
|-------|-----------|
| Language | TypeScript |
| Structured outputs & LLM contracts | **Zod** — shared with [`packages/ai`](packages/ai/agents.md) and [`packages/agents`](packages/agents/agents.md) (`session.prompt({ result })`, `ResultValidator`, `generateObject`-style extraction). JSON Schema for strict provider modes via a zod→JSON Schema converter at the AI boundary. |
| Package manager | pnpm |
| Monorepo | pnpm workspaces |
| Web app | Next.js + shadcn/ui on **Cloudflare Pages** |
| Edge endpoints | **Cloudflare Workers** (capture POST, hot reads) |
| Heavy backend | **Fly.io** (scraper, transcribe, agent runners, queue worker, write API) |
| AI | Vercel AI SDK + AI Gateway via [`packages/ai`](packages/ai/agents.md); **Zod** for structured generations and eval fixtures |
| Agent harness | [`packages/agents`](packages/agents/agents.md) (Flue-shaped, custom runtime); **Zod** for `result` schemas and `ResultValidator` |
| Queue | pg-boss on Neon (V1+); in-memory + node-cron in V0 |
| DB | **Neon (serverless Postgres) + Prisma v7** |
| Vector | **pgvector on Neon** (V1+) |
| Object storage | **Cloudflare R2** (S3-compatible) |
| V0 storage | Local disk for both evidence and metadata behind storage interfaces |
| Auth | **better-auth** via [`packages/auth`](packages/auth/agents.md); workspaces/orgs as tenant boundary |
| Browser automation | Playwright (Fly.io) |
| HTML -> Markdown | Defuddle (per [ADR 0008](docs/decisions/0008-html-to-markdown-defuddle.md)) |
| Transcripts | YouTube API -> Whisper local on Fly -> Gemini -> OpenAI ([ADR 0009](docs/decisions/0009-transcript-tiered-pipeline.md)) |
| Observability | pino (V0) -> OpenTelemetry exporter (V1+) |
| Mobile | Responsive web in V1; native shell deferred |

## Sub-module catalog

Per-package `agents.md` files own their own contracts. Runtime targets: `node` = Fly, `workers` = CF Workers, `both`.

| Package | Owns | Runtime |
|---------|------|---------|
| [`packages/scraper`](packages/scraper/agents.md) + adapters | `Fetcher`, `ThrottleManager`, `WafDetector`, `ProxyPool`, per-source `Adapter`. HTTP-first + Playwright wisdom (AIA, AIMD, WAF, `needsBrowser`). | node |
| [`packages/storage`](packages/storage/agents.md) | `EvidenceStore`, `MetadataStore`, `WikiStore` contracts; V0 disk default. | both |
| [`packages/storage-r2`](packages/storage-r2/agents.md) | `EvidenceStore` over Cloudflare R2 / S3. | both |
| [`packages/storage-neon`](packages/storage-neon/agents.md) | `MetadataStore` over Neon + Prisma v7; pgvector tables. | both |
| [`packages/wiki-fs`](packages/wiki-fs/agents.md) | `WikiStore` over disk (V0 / dev). | node |
| [`packages/wiki-r2`](packages/wiki-r2/agents.md) | `WikiStore` over R2 with content-addressed snapshots. | both |
| [`packages/dedup`](packages/dedup/agents.md) | `DedupKeyer`, compositional `Scorer`, `MergeDecider`. V0 deterministic + lexical; V1+ vector contributor. | both |
| [`packages/agents`](packages/agents/agents.md) | The harness contract (Flue-shaped surface); **Zod**-only `result` / `ResultValidator`. | both |
| [`packages/agents-runtime`](packages/agents-runtime/agents.md) | Thin custom runtime impl. | both |
| [`packages/agents-sandboxes`](packages/agents-sandboxes/agents.md) | Sandbox backends: `virtual`, `local-node`, `daytona`, `e2b`, `vercel-sandbox`. | depends |
| [`packages/wiki`](packages/wiki/agents.md) | Karpathy wiki layout + maintainer skills (`wiki-ingest`, `wiki-query`, `wiki-lint`); **Zod** for harness-visible `result` types. | both |
| [`packages/capture`](packages/capture/agents.md) | Universal clipper backend: `POST /api/captures` + processing pipeline + per-host heuristic registry; **Zod** validates versioned request/response payloads at the edge. | both |
| [`packages/transcribe`](packages/transcribe/agents.md) | Tiered `Transcriber` pipeline. | node (Fly for ffmpeg + faster-whisper) |
| [`packages/auth`](packages/auth/agents.md) | better-auth wrapper; workspaces/orgs as tenant. | both |
| [`packages/queue`](packages/queue/agents.md) | `Queue` + `Scheduler`. V0 in-memory; V1+ pg-boss on Neon. | node |
| [`packages/search`](packages/search/agents.md) | `SearchIndex` (BM25) + `VectorStore` (pgvector). | both |
| [`packages/ai`](packages/ai/agents.md) | Vercel AI SDK + AI Gateway + `ModelProvider` routing + `Embedder`; **Zod** for structured outputs and shared DTOs with the harness. | both |
| [`packages/observability`](packages/observability/agents.md) | `Logger` + `Tracer` + `MetricsSink` (Layers 1+2 of telemetry stack). | both |
| [`packages/telemetry`](packages/telemetry/agents.md) | `ProductEvents` (Layer 3: product analytics + agent run traces, self-hosted PostHog default). V0 docs only; V1+ scaffold. | both |
| [`apps/extension`](apps/extension/agents.md) | Universal browser clipper (Manifest v3, V2). | browser |

## Hybrid deployment one-liner

CF Pages hosts the Next.js app. CF Workers handle latency-critical edge endpoints (capture POST, hot reads). Fly.io runs the scraper (got + Playwright), transcribe (ffmpeg + faster-whisper), agent runners (wiki maintainer, ranker), queue worker (pg-boss), and write API. Neon (Postgres + pgvector) and R2 are the shared source of truth; better-auth tokens are validated identically on both runtimes. Detail in [docs/architecture/deployment.md](docs/architecture/deployment.md).

## How agents should work here

1. Keep changes tied to the searcher workflow. If a scraper change does not improve deal discovery, enrichment, dedup, or pipeline usability, question it.
2. Read the relevant package's `agents.md` and the linked architecture docs before editing code.
3. Extend shared types and contracts before wiring UI or source-specific logic. Prefer **Zod** at API and LLM boundaries (same discipline as [`packages/ai`](packages/ai/agents.md) / [`packages/agents`](packages/agents/agents.md)).
4. Add new sources as adapters (in `packages/scraper/adapters/<source>/`), with tests and source notes.
5. Preserve provenance and raw evidence for extracted fields (`SourceRecord`s are append-only).
6. Avoid broad refactors while adapters, schema, and product boundaries are still evolving.
7. When adding a new system (a new backend, a new sandbox, a new transcriber, a new heuristic), prefer a sibling package over invasive changes to a contract package.
8. When you make a load-bearing decision, write an ADR in [docs/decisions/](docs/decisions/) and remove the resolved entry from [open.md](docs/decisions/open.md).
9. **Every spec edit lands with its validation criteria.** New `agents.md`, new ADR, new design doc → must include a `## Validation criteria` (or `## Falsifiability criteria` for ADRs) section before merge. Implementation order inside each step: criteria → failing tests → implementation → green → commit. See [docs/architecture/spec-template.md](docs/architecture/spec-template.md).
10. **npm dependency release lag (~30 days / ~4 weeks).** Follow [docs/operations/dependency-lag.md](docs/operations/dependency-lag.md): keep `pnpm-workspace.yaml`, `scripts/dependency-lag.config.json`, and `renovate.json` in sync; avoid refreshing the lockfile with brand-new transitive releases; run `pnpm run verify:dependency-lag` when you touch dependencies. Security bumps before the lag window: use Renovate’s security bypass, temporary `minimumReleaseAgeExclude`, or dated `securityAgeExceptions` in `dependency-lag.config.json` (see that doc).
11. **Regressions and specs.** If a test that used to pass now fails: fix the code to match the spec first; if the spec is wrong, update the spec in the same PR with clear validation criteria; if you cannot reconcile without dropping or gutting tests or contradicting acceptance criteria, get explicit human approval before merging. Details under [Commit hygiene](#commit-hygiene).

## Commit hygiene

Prefer **small, coherent commits** (one logical change per commit) over large “everything at once” checkpoints, so history stays reviewable and `git bisect` stays useful.

- **Test, then commit:** once the change is covered by the right tests and they pass, **split the diff into sensible commits** (implementation vs tests vs docs) instead of one opaque blob. Avoid committing known-red main unless the team explicitly agreed on a failing-test-first sequence for that task.
- **Subject line:** imperative mood, about 50 characters, no trailing period. Examples: `feat(storage): stream raw evidence to disk`, `fix(cli): resolve fixture path from dist`, `chore(ci): run dependency lag verifier`.
- **Style:** [Conventional Commits](https://www.conventionalcommits.org/) optional but encouraged — `feat`, `fix`, `docs`, `chore`, `test`, `ci`, with an optional scope in parentheses (`feat(dedup): …`).
- **Completeness:** each commit should leave the repo in a sensible state (changed packages still typecheck; touched areas covered by existing or new tests when the change is non-trivial).
- **Before push:** run `pnpm lint`, `pnpm test`, and `pnpm lint:specs`; when `pnpm-lock.yaml` or dependencies change, also run `pnpm run verify:dependency-lag`.
- **Hygiene:** never commit secrets, `.env*`, or local `data/`; keep `pnpm-lock.yaml` in sync with manifest changes in the same PR when possible.

**When a previously passing test breaks:** (1) assume the spec is right — fix the code first. (2) If the failure exposes a wrong or outdated spec, **negotiate with the spec**: update the relevant `agents.md`, phase doc, ADR, or architecture doc in the **same PR** as the behavior change, keep or adjust `## Validation criteria`, and explain the shift in the PR description. (3) If you cannot reconcile code, tests, and spec without deleting coverage, weakening a load-bearing assertion, or contradicting published acceptance criteria, **stop and ask for explicit human approval** before proceeding; do not silently drop or gut tests.

Large one-off imports (e.g. initial monorepo scaffold) may use a short series of commits by concern (docs → toolchain → `packages/core` → …) instead of a single massive commit.

## Validation criteria

The repo as a whole is healthy when:

- **Phase acceptance:** every published phase doc's acceptance list is covered by passing tests. V0 acceptance lives in [docs/phases/V0.md](docs/phases/V0.md); V1+ in their respective phase docs.
- **Spec discipline:** `pnpm lint:specs` walks every `agents.md`, ADR, and `docs/{architecture,phases,operations,product}/*.md` and exits 0. V0 ships this as advisory; V1+ enforces it as a pre-commit hook + CI gate.
- **Dependency release lag:** `pnpm-workspace.yaml` `minimumReleaseAge` matches `scripts/dependency-lag.config.json`; CI runs `pnpm run verify:dependency-lag` on the committed lockfile. Policy: [docs/operations/dependency-lag.md](docs/operations/dependency-lag.md).
- **Pluggable everything:** every contract listed in [docs/architecture/contracts.md](docs/architecture/contracts.md) names its conformance suite path; every backend invokes that suite from its tests.
- **Identity propagation:** for any V1+ trace, querying VictoriaMetrics, the OTel trace backend, and PostHog by the same `traceId` returns correlated results.
- **Commit hygiene:** merged PRs use scoped, reviewable commits and clear messages; no secrets or local-only artifacts in git history; regressions are fixed or specs are updated in-band—silent test removal or weakened assertions without approval is out of bounds. Coverage: manual review (see [Commit hygiene](#commit-hygiene)).

Coverage tags: phase acceptance is `smoke`/`integration`; spec lint is `smoke` (script); pluggability is `smoke` (lint); identity propagation is `integration`. Test paths are listed in each downstream spec's `## Validation criteria`.

## External references

ETA deal sources catalog (referenced product context): BizBuySell, BizQuest, BusinessBroker.net, BusinessesForSale.com, LoopNet, BizBen, DealStream, Baton Market, Axial (private), Searchfunder, Acquire.com, Empire Flippers, Quiet Light, FE International.

Apify actors (kept as optional `Fetcher` fallback per [ADR 0013](docs/decisions/0013-apify-as-optional-fallback.md)):

- [acquistion-automation/bizbuysell-scraper](https://apify.com/acquistion-automation/bizbuysell-scraper/reviews)
- [fatihtahta/bizbuysell-scraper](https://apify.com/fatihtahta/bizbuysell-scraper)
- [crawlerbros/bizbuysell-scraper](https://apify.com/crawlerbros/bizbuysell-scraper)

Agent harness references:

- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Scaling Managed Agents: Decoupling the brain from the hands](https://www.anthropic.com/engineering/managed-agents)
- [Agent Harness Engineering — Addy Osmani](https://addyosmani.com/blog/agent-harness-engineering/)
- [Flue (Astro) — public-surface inspiration](https://github.com/withastro/flue)
- [Open Agents (Vercel Labs) — production-shape inspiration](https://github.com/vercel-labs/open-agents)
- [OpenHarness](https://github.com/HKUDS/OpenHarness)

LLM wiki references:

- [Karpathy's llm-wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
- [Hacker News discussion](https://news.ycombinator.com/item?id=47899844)

---

This guide should evolve as packages are scaffolded and product decisions become real. Keep it current.
