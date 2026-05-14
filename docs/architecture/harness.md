# Agent harness architecture

Clearbolt's agent harness is a thin custom runtime in [`packages/agents`](../../packages/agents/agents.md). Its **public surface mirrors [Flue](https://github.com/withastro/flue)** so we can adapt Flue's features into our shape with least disruption. ADR: [../decisions/0005-harness-borrow-flue-patterns.md](../decisions/0005-harness-borrow-flue-patterns.md).

We do not depend on Flue at runtime.

## What a harness is

A harness is the model plus the surrounding state, tools, prompts, memory, tests, evaluators, and recovery paths. Long-running workflows need durable artifacts and incremental progress, not a single prompt.

Use a harness where the workflow has:

- Multiple steps over time.
- Tool use against private workspace data.
- Need for evidence, scoring, or review.
- A planner/evaluator split.
- Durable handoff between sessions.

## Public surface (Flue mirror)

```ts
import { init } from '@clearbolt/agents';

const harness = await init({
  model: 'openai/gpt-4o',
  tools: [...],
  sandbox: 'virtual',
  role: 'You are a deal analyst.',
  cwd: process.cwd(),
});

const session = harness.session('research-deal-123');

const { data } = await session.prompt(
  'Summarize the financial highlights and risks.',
  {
    result: dealSummarySchema,  // zod
    role: 'Be concise; cite source page numbers.',
  }
);

await session.task('Lint the deal wiki and fix obvious contradictions.', {
  cwd: 'workspaces/abc/wiki/deals/123',
});

await session.skill('wiki-ingest', {
  args: { sourceRecordId: 'src-456' },
});
```

Mirrored from Flue:

- `init({ model, tools?, sandbox?, role?, name?, cwd? }) -> Harness`.
- `harness.session(threadName?) -> Session`. Default thread = `"default"`.
- `session.prompt(text, { result?, role?, model?, tools? }) -> { data, text, usage }`. `data` is schema-validated when `result` is provided.
- `session.task(text, { cwd?, role?, result? })` runs a one-shot child agent in a detached session sharing the same sandbox/filesystem.
- `session.skill(name, { args, result? })` invokes a parameterized prompt template loaded from `.agents/skills/<name>.md` (frontmatter `name:` or relative path).
- `connectMcpServer(name, { url, headers?, transport?: 'http' | 'sse' })` registers MCP tools.
- `AGENTS.md` discovered from CWD acts as a system-prompt overlay; nested `AGENTS.md` files in subdirectories layer additional context for tasks scoped there.
- Roles are call-scoped overlays, not user-message injections; precedence is `call > session > harness`.

## Internals (deliberately not Flue's)

- Built-in `filesystem` tool reads/writes through `WikiStore` and `EvidenceStore` abstractions, not raw disk. The agent never touches local filesystem in production — it touches R2 through the WikiStore contract.
- Built-in domain tools registered by default: `searchListings`, `lookupBroker`, `runDedupCheck`, `wikiUpsertPage`, `getCanonicalDeal`, `attachSourceRecord`, `enqueueTranscribe`, `enqueueScrape`.
- `SessionStore` is workspace-scoped and pluggable (memory / Postgres / Cloudflare Durable Objects).
- `Sandbox` defaults to `virtual` (in-process, no shell). `local-node` and container providers (`daytona`, `e2b`, `vercel-sandbox`) are opt-in.
- Multi-target build (node + workers) via Flue's pattern; Vercel AI SDK as the model layer behind `Harness.prompt()`.

## Candidate harnesses (built on top)

Each candidate is a set of skills + the same harness runtime, not a separate harness implementation:

- **Market Definition Harness**: interviews the buyer, drafts a structured market definition, identifies positive/negative screens, produces criteria usable by saved searches and ranking.
- **Ingestion Harness**: orchestrates saved searches/imports, classifies failures, queues enrichment.
- **Dedup Harness**: generates candidates using blocking/lexical/vector signals, scores likely duplicates, explains evidence, sends uncertain cases to review.
- **Broker/Source Enrichment Harness**: follows permitted source links, extracts broker/contact/business info, tracks provenance.
- **Deal Ranking Harness**: combines shared-cache retrieval with workspace-specific market fit, buyer capacity, financing scenarios, quality signals, and feedback-derived preferences into explainable rankings.
- **Quality of Deal Harness**: reviews listing/source evidence, flags diligence gaps, produces a quality-of-deal summary and checklist.
- **Wiki Maintainer Harness**: ingest/query/lint the per-deal wiki (see [wiki.md](wiki.md) and [`packages/wiki/agents.md`](../../packages/wiki/agents.md)).
- **Universal Clipper Harness**: HTML -> Markdown, structured extraction from captured pages (see [capture.md](capture.md)).
- **Outreach Harness**: drafts outreach, schedules follow-ups, summarizes replies/calls, respects suppression/opt-out rules.
- **Deal-Team Shopping Harness (roadmap)**: matches buyer/deal context to brokers, bankers, lawyers, CPAs, QoE providers with explicit consent controls.

## Harness patterns

- Use planner/generator/evaluator roles for subjective or high-stakes outputs (market definitions, quality-of-deal scoring, deal-team recommendations).
- Write durable artifacts for every long-running workflow: inputs, assumptions, source references, intermediate decisions, final outputs, next actions.
- Keep "brain" and "hands" conceptually separate: the agent reasoning loop calls tools for search, scraping, storage, email, browser rather than embedding side effects inside prompts.
- Use structured contracts (`result: schema`) before execution: what is being produced, what evidence is required, how success will be verified, what requires human approval.
- Prefer incremental progress: one saved search run, one dedup batch, one market section, one outreach step at a time.
- Require evaluator or deterministic checks before marking high-impact work complete.

## Where the runtime runs

Harness runs on **Fly.io** for long-running, tool-using, multi-step work (wiki maintainer, ranker, quality scorer, outreach drafter). The runtime also builds for Workers so smaller harness sessions can run on CF when latency matters.

See [deployment.md](deployment.md).

## When to update the harness from Flue

When Flue ships a feature we want, ADR `0005-harness-borrow-flue-patterns.md` is the place we record the adaptation: what we took, how we shaped it to our internals, what we deliberately left behind. Public surface stays stable; internals evolve.

## Validation criteria

### Functional
- **Given** `init({ model, tools, sandbox: 'virtual' })`, **when** called, **then** it returns a `Harness` with the public-surface methods listed above. Coverage: unit. Test: `packages/agents/tests/init-returns-harness.test.ts` (TBD V1).
- **Given** a `Session.prompt(text, { result: schema })`, **when** the model returns text, **then** `data` is schema-validated; if validation fails, the harness re-prompts (up to N retries) before erroring. Coverage: integration. Test: `packages/agents/tests/result-schema-validation.test.ts` (TBD V1).
- **Given** an `AGENTS.md` file in the CWD, **when** `harness.session()` is created, **then** the file content is included as a system-prompt overlay; nested `AGENTS.md` in subdirs layer per-task. Coverage: integration. Test: `packages/agents/tests/agents-md-discovery.test.ts` (TBD V1).
- **Given** `connectMcpServer(name, { url })`, **when** called, **then** the registered MCP tools are available in `session.prompt({ tools: [...] })`. Coverage: integration. Test: `packages/agents/tests/mcp-tools-available.test.ts` (TBD V1).

### Built-in domain tools
- **Given** the default tool set, **when** `searchListings`, `lookupBroker`, `runDedupCheck`, `wikiUpsertPage`, `getCanonicalDeal`, `attachSourceRecord`, `enqueueTranscribe`, `enqueueScrape` are invoked, **then** each routes through the appropriate domain package contract (no direct Postgres/R2 calls from inside the tool). Coverage: integration. Test: `packages/agents/tests/built-in-tools-route-through-contracts.test.ts` (TBD V1).
- **Given** the built-in `filesystem` tool, **when** the agent reads or writes, **then** the call routes through `WikiStore`/`EvidenceStore`, not the local disk (in production). Coverage: contract guard. Test: `packages/agents/tests/filesystem-tool-uses-storage.test.ts` (TBD V1).

### Sandboxing
- **Given** `sandbox: 'virtual'` (default), **when** a skill runs, **then** no shell process is spawned. Coverage: integration. Test: `packages/agents-sandboxes/tests/virtual-no-spawn.test.ts` (TBD V1).
- **Given** `sandbox: 'daytona'` or `'e2b'` (V2+), **when** a skill runs that needs shell, **then** stdout/stderr/files round-trip through the sandbox contract. Coverage: integration. Test: `packages/agents-sandboxes/tests/<provider>-roundtrip.test.ts` (TBD V2).

### Multi-tenancy
- **Given** a `SessionStore`, **when** a session is created with `workspaceId: A`, **then** queries for sessions in `workspaceId: B` return empty. Coverage: integration. Test: `packages/agents/tests/session-store-workspace-scoped.test.ts` (TBD V1).
- **Given** a tool call from inside a workspace-scoped session, **when** it would access another workspace's data, **then** the call is rejected by the underlying contract (defense-in-depth). Coverage: integration. Test: `packages/agents/tests/cross-workspace-tool-rejected.test.ts` (TBD V1).

### Telemetry
- **Given** any `harness.session()`, **when** `prompt`/`task`/`skill` is invoked, **then** a Layer 2 `harness.session` span and a Layer 3 `agent.session_started` event are emitted with the same `sessionId` + `traceId`. Coverage: integration. Test: `packages/agents/tests/cross-layer-identity.test.ts` (TBD V1).

### Custom-runtime guard
- **Given** the codebase, **when** scanned, **then** `packages/agents-runtime/src/**` does not import `flue` or `@withastro/flue`. Coverage: lint. Test: `scripts/lint-specs.mjs::no_flue_runtime` (TBD V1).
