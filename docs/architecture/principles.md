# Architectural Principles

Five principles drive every layout, packaging, and runtime decision in Clearbolt. Encoded as ADRs `0005`, `0006`, `0007`, `0010`, `0011`, `0012`, `0015`. Every contributor change should map to one or more of these.

## 1. Pluggable everything

Each domain package owns one or more *contracts* (TypeScript interfaces) and ships a default V0 backend that satisfies them. Heavier backends (R2, Neon/Prisma, container sandboxes, paid transcript APIs) live as sibling packages so V0 has zero heavy deps and V1+ adds backends without invasive refactors.

In practice:

- A package like `packages/storage/` defines `EvidenceStore`, `MetadataStore`, `WikiStore` interfaces and ships a disk-backed default.
- Cloud-backed implementations live as sibling packages: `packages/storage-r2/`, `packages/storage-neon/`, `packages/wiki-r2/`.
- The application binds the chosen backend at startup; consuming code depends only on the contract.
- New backends (Supabase, GCS, S3, Qdrant, etc.) drop in as new sibling packages without touching consumers.

This is the inverse of the "kitchen sink in one package" pattern. Every implementation is a backend; the contract package is small and stable.

The canonical inventory of every contract and its current/planned backends lives in [contracts.md](contracts.md).

ADR: [0006-pluggable-everything.md](../decisions/0006-pluggable-everything.md).

## 2. Flue-shaped agent harness, custom runtime

`packages/agents/` exposes a public surface that mirrors [Flue](https://github.com/withastro/flue) — `init`, `harness.session()`, `session.prompt({ result })`, `session.task()`, `session.skill()`, `connectMcpServer()`, **Zod** result schemas (Flue may support valibot too; Clearbolt standardizes on Zod), `AGENTS.md` + `.agents/skills/<name>.md` discovery from CWD.

Internals are ours. We do not depend on Flue at runtime.

"Steal periodically" means: when Flue ships a feature we want, we adapt the design into our internals while keeping our public surface stable. Each adaptation is recorded in [`0005-harness-borrow-flue-patterns.md`](../decisions/0005-harness-borrow-flue-patterns.md) — what we took, how we shaped it to our internals, what we deliberately left behind.

The harness contract is detailed in [harness.md](harness.md) and `packages/agents/agents.md`.

## 3. Karpathy-style LLM wiki for per-deal knowledge

Raw sources stay immutable in `EvidenceStore`. The wiki maintainer agent compiles them into a per-workspace, per-deal markdown wiki plus a shared cross-deal entity layer (brokers, owners, industries, MSAs).

- Three layers: **raw sources** (immutable), **wiki** (LLM-maintained markdown), **schema** (`AGENTS.md` tells the maintainer how to behave).
- Three operations: **ingest** (new source -> update affected pages), **query** (answer + file good answers back as new pages), **lint** (detect contradictions, stale claims, orphans, missing pages).
- One ingest typically touches 8-15 wiki pages.
- The wiki is per-workspace; canonical deals/brokers/listings live in the shared cache and are read-only from inside a workspace's wiki.

The wiki layout and maintainer ops are detailed in [wiki.md](wiki.md) and `packages/wiki/agents.md`. ADR: [0007-per-deal-llm-wiki.md](../decisions/0007-per-deal-llm-wiki.md).

## 4. Hybrid Cloudflare + Fly.io deployment

Production runs across two platforms with Neon (Postgres + pgvector) and R2 as the shared truth.

- **Cloudflare Pages**: Next.js web app.
- **Cloudflare Workers**: latency-critical edge endpoints (capture POST, hot read APIs).
- **Fly.io**: heavy backend services — scraper (got + Playwright + AIA + AIMD), transcribe (ffmpeg + faster-whisper), agent runners (wiki maintainer, ranking, lint passes), queue worker, the bulk of the write API surface.
- **Neon (Postgres + pgvector)**: source of truth. Both runtimes connect — CF via Neon HTTP driver, Fly via node-postgres.
- **R2**: blobs + wiki markdown. Both runtimes use S3 SDK.
- **better-auth**: tokens validated identically on both sides; workspaces are the tenant boundary.

This split is the result of hard runtime constraints (no Playwright on Workers, no ffmpeg on Workers, no large local model on Workers) crossed with where each platform shines (CF for global edge latency on user-facing endpoints; Fly for unconstrained heavy compute).

The boundary contract and a topology diagram live in [deployment.md](deployment.md). ADR: [0010-deployment-hybrid-cf-fly.md](../decisions/0010-deployment-hybrid-cf-fly.md).

## 5. Specs include validation criteria, negotiated before commit

Every spec — package `agents.md`, ADR, contract definition, design doc, phase doc — must include a `## Validation criteria` section listing concrete, testable assertions. Specs and their validation criteria are reviewed together; a spec is not committed without them.

In practice:

- A spec without testable assertions is half a spec. If you cannot say what would prove the spec is satisfied, the spec is not yet specified.
- For contracts and packages: criteria are `Given … when … then …` assertions tied to test files (unit, conformance, integration, golden-set, property, smoke).
- For ADRs: criteria are **falsifiability conditions** — what observable would tell us this decision was wrong (a kill switch, not a comfort blanket).
- For phase docs: criteria are the acceptance list — what behaviors a user can exercise when the phase ships.
- For operations docs: criteria are observable thresholds (latency p95, cost/month, freshness, error rate).
- For product docs: criteria are checkable heuristics — funnel rates, NPS thresholds, qualitative review notes.

Implementation order inside any package step: **validation criteria → failing tests for those criteria → implementation → tests green → commit**. The commit message references which criteria are now covered.

The canonical shape every new spec uses lives in [spec-template.md](spec-template.md). The strategy that maps criterion types to test types lives in [testing-strategy.md](testing-strategy.md). A `pnpm lint:specs` script walks every spec doc and fails if `## Validation criteria` is missing.

ADR: [0015-specs-include-validation-criteria.md](../decisions/0015-specs-include-validation-criteria.md).

## How these principles compose

These five principles reinforce each other:

- **Pluggable everything** + **hybrid deployment** means every contract has at least two backends (CF-runtime + Fly-runtime) where it makes sense, and consumers depend only on the contract — they do not know which runtime they are running in.
- **Flue-shaped harness** + **pluggable everything** means the agent harness is itself a set of contracts (Sandbox, SessionStore, MCPClient, ResultValidator) with swappable backends.
- **Karpathy wiki** + **Flue-shaped harness** means the wiki maintainer is just another agent built on the harness, with the wiki filesystem as its primary tool surface.
- **Validation criteria as part of every spec** + **pluggable everything** means every contract ships with a conformance suite that any backend must pass — backends become substitutable in fact, not just in shape.
- All five principles together mean that V0 (local dev, disk only, no AI required to run) and V1+ (production, hybrid cloud, AI-driven) share contracts, conformance suites, and validation discipline — not just types.

When in doubt, prefer the principle that maximizes optionality for the future without adding cost today.

## Validation criteria

The principles themselves must be observable in the codebase. If any of these fails, the corresponding principle is silently failing.

- **Pluggable everything**: adding a new backend for an existing contract requires changes to **zero** consumer packages. Surfaced as a CI check against the contracts inventory.
- **Flue-shaped harness, custom runtime**: `packages/agents` has **zero** runtime imports of `flue` or `@withastro/flue`. Verified by `pnpm lint:specs --no-flue-runtime`.
- **Karpathy-style LLM wiki**: `packages/wiki` exposes ingest / query / lint operations and stores pages as plain markdown — verifiable by reading the wiki directory with `cat`. ADR 0007 captures the falsifiability conditions.
- **Hybrid Cloudflare + Fly.io deployment**: every contract listed in [contracts.md](contracts.md) has a `Runtime` cell that is one of `node`, `workers`, `both`. CI fails if any contract has missing runtime annotations.
- **Specs include validation criteria**: `pnpm lint:specs` walks every `agents.md`, ADR, and `docs/architecture/`, `docs/phases/`, `docs/operations/` doc, and exits non-zero if `## Validation criteria` (or `## Falsifiability criteria` for ADRs) is missing. Pre-commit hook enforces this in V1+.
