# ADR 0005 — Agent harness: thin custom runtime, Flue-shaped public surface

Status: accepted

## Context

Long-running, multi-step agent workflows need durable artifacts, tool registries, sandboxing, MCP support, structured outputs, skill loading, and `AGENTS.md` discovery. Building this from scratch is expensive; depending wholesale on a third-party runtime trades velocity for control.

Surveyed:

- **Flue** — clean public API, valibot/zod result schemas upstream, `AGENTS.md` + `.agents/skills/` loader, MCP support, multi-target build (node + workers). Young; tightly coupled to its runtime.
- **Open Agents** — production scaffolding (better-auth, Neon, Vercel Workflow SDK, streaming UI). Heavier; opinionated on whole-app shape.
- **From scratch** — maximum control, slowest.

## Decision

**Option 2: thin custom runtime in [`packages/agents-runtime`](../../packages/agents-runtime/agents.md), public surface mirrors Flue.**

- Public surface (`init`, `harness.session()`, `session.prompt({ result })`, `session.task()`, `session.skill()`, `connectMcpServer()`, `AGENTS.md` + `.agents/skills/` loader, structured `result` schemas) is one-to-one with Flue **except** Clearbolt standardizes on **Zod** for `ResultValidator` and `session.prompt({ result })` — no valibot in the default path (optional adapter later only if Flue parity demands it).
- Internals are ours: built-in `filesystem` tool routes through `WikiStore`/`EvidenceStore`, default domain tools (`searchListings`, `lookupBroker`, `wikiUpsertPage`, etc.), workspace-scoped `SessionStore`, `Sandbox` defaults to `virtual` (in-process), multi-target build node + workers.
- "Steal periodically" means: when Flue ships a feature we want, we adapt the design into our internals while keeping our public surface stable. Each adaptation is recorded as an addendum to this ADR (or a follow-up ADR) — what we took, how we shaped it, what we deliberately left behind.

## Consequences

- We retain control over data-access patterns, multi-tenancy enforcement, and tool side effects.
- Code we write in `packages/agents` looks like Flue code, lowering the barrier for contributors familiar with Flue.
- Migration to an actual Flue dependency later is possible if it stabilizes — minimal application-code change.
- We carry the runtime maintenance burden (turn loop, model integration via Vercel AI SDK, MCP transport). Acceptable: most of the volume is straightforward; the unique value is in the contracts and built-in tools.

## Falsifiability criteria

- **Trigger**: `packages/agents-runtime` imports `flue` or `@withastro/flue` at runtime.
  **Measurement**: `pnpm lint:specs --no-flue-runtime` walks `packages/agents-runtime/src/**` for the import.
  **Response**: incident; the principle requires we own the runtime.
- **Trigger**: a Flue feature ships and we cannot reproduce it within ~2 weeks because our internals diverge too far.
  **Measurement**: tracked feature requests against `packages/agents-runtime` referencing Flue.
  **Response**: revisit; decide whether to (a) adopt Flue as the runtime dep after all, or (b) accept the divergence and stop tracking.
- **Trigger**: more than 30% of harness consumer code (apps + non-agents packages) references runtime internals (anything not exported from `packages/agents/src/index.ts`).
  **Measurement**: lint over consumer imports.
  **Response**: tighten the public surface; expose what consumers need or rewrite consumers to use the public API.
- **Trigger**: harness session p50 turn latency exceeds 5 seconds for trivial single-prompt runs (no tool calls).
  **Measurement**: `harness.session` span duration in tracing.
  **Response**: profile the runtime; the abstraction is paying too much overhead.
- **Trigger**: the cost of maintaining our runtime exceeds 1 engineer-week per quarter.
  **Measurement**: time-tracked work against `packages/agents-runtime`.
  **Response**: revisit; consider adopting Flue or another runtime with shared maintenance.
