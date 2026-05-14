# `packages/agents` — the harness contract

> Runtime: **both** (node + workers). Multi-target build mirrors Flue's pattern.

The harness contract. Public surface mirrors [Flue](https://github.com/withastro/flue). Internals are ours.

**Zod** is the contract for structured outputs: `session.prompt({ result })`, `session.task`, and `ResultValidator` all take `z.ZodTypeAny`. Import shared `z` schemas from [`packages/ai`](../ai/agents.md) when a tool or skill wraps the same DTO the model fills.

ADR: [`docs/decisions/0005-harness-borrow-flue-patterns.md`](../../docs/decisions/0005-harness-borrow-flue-patterns.md). Cross-cuts [`docs/architecture/harness.md`](../../docs/architecture/harness.md).

The runtime implementation lives in [`packages/agents-runtime`](../agents-runtime/agents.md). Sandbox backends in [`packages/agents-sandboxes`](../agents-sandboxes/agents.md).

## Public surface (Flue mirror)

```ts
import { init, connectMcpServer } from '@clearbolt/agents';

const harness = await init({
  model: 'openai/gpt-4o',
  tools: [...],
  sandbox: 'virtual',
  role: 'You are a deal analyst.',
  cwd: process.cwd(),
});

const session = harness.session('research-deal-123');

// Structured prompt with zod result schema:
const { data, text, usage } = await session.prompt(
  'Summarize the financial highlights and risks.',
  {
    result: dealSummarySchema,
    role: 'Be concise; cite source page numbers.',
  }
);

// One-shot child agent in detached session sharing sandbox:
const lintReport = await session.task(
  'Lint the deal wiki and fix obvious contradictions.',
  { cwd: 'workspaces/abc/wiki/deals/123', result: lintReportSchema }
);

// Skill = parameterized prompt template loaded from .agents/skills/<name>.md:
await session.skill('wiki-ingest', {
  args: { sourceRecordId: 'src-456' },
});

// MCP servers register tools globally on the harness:
await connectMcpServer('search', {
  url: 'https://mcp.example.com/sse',
  transport: 'sse',
});
```

## Mirrored from Flue

- `init({ model, tools?, sandbox?, role?, name?, cwd? }) -> Harness`.
- `harness.session(threadName?) -> Session`. Default thread = `"default"`.
- `session.prompt(text, opts) -> { data, text, usage }`. `data` validated when `result` schema provided.
- `session.task(text, opts)` — one-shot child agent in detached session, same sandbox/filesystem.
- `session.skill(name, opts)` — parameterized prompt template from `.agents/skills/<name>.md` (frontmatter `name:` or relative path).
- `connectMcpServer(name, { url, headers?, transport?: 'http' | 'sse' })` — register MCP tools.
- `AGENTS.md` from CWD acts as a system-prompt overlay; nested `AGENTS.md` files in subdirectories layer additional context for tasks scoped there.
- Roles are call-scoped overlays, not user-message injections; precedence: `call > session > harness`.
- Result schemas use **Zod** (`z.infer<typeof schema>`) only; share modules with [`packages/ai`](../ai/agents.md) for the same DTO across `generateObject` and harness calls.

## Our internals (deliberately not Flue's)

### Tools

- Built-in `filesystem` tool routes through `WikiStore` and `EvidenceStore` abstractions, **not** raw disk. The agent never touches local filesystem in production.
- Built-in domain tools registered by default:
  - `searchListings({ workspaceId, criteria })` — workspace-aware listing search.
  - `lookupBroker({ id | name })`.
  - `runDedupCheck({ sourceRecordId })`.
  - `wikiUpsertPage({ workspaceId, target, payload })`.
  - `getCanonicalDeal({ id })`.
  - `attachSourceRecord({ sourceRecordId, canonicalDealId })`.
  - `enqueueScrape({ savedSearchId })`.
  - `enqueueTranscribe({ url, hint? })`.
- Custom tools registered via `init({ tools: [...] })` or via MCP.

### Sandbox

- `Sandbox` defaults to `virtual` (in-process, no shell). Built-in tool calls execute synchronously via the registered tool registry — no subprocess.
- `local-node` sandbox spawns a Node subprocess for shell commands.
- Container providers (`daytona`, `e2b`, `vercel-sandbox`) ship in `packages/agents-sandboxes`.

### SessionStore

- Workspace-scoped: every session is bound to a `workspaceId`.
- Pluggable backend (memory / Postgres / Cloudflare Durable Objects).
- V0/V1 in-memory; V1+ Postgres via [`packages/storage-neon`](../storage-neon/agents.md); V2+ optional DO adapter for CF-side sessions.

### SkillsLoader

- File-based by default: discovers `.agents/skills/*.md` from CWD upward.
- Each skill is markdown with optional frontmatter (`name`, `description`, `args`, `result`).
- V1+ optional DB-backed registry for workspace-private skills.

### MCPClient

- Wraps the public MCP spec.
- Same `connectMcpServer` shape as Flue.
- Tools surfaced through the harness's tool registry; the model sees them like any other tool.

### ResultValidator

- Accepts **Zod** schemas (`z.ZodTypeAny`). No alternate schema DSL in the default stack.
- Validation errors retried up to N times with the validator's error fed back as a system message; gives up with a structured error after N.

### Multi-target build

- Two entry points: `node` (Fly) and `workers` (CF). Same TypeScript source, different bundling.
- Built-in tools that need Node-only deps (Playwright, ffmpeg) are in separate packages or behind a runtime check.

## Where it runs

- **Fly.io** for long-running, tool-using, multi-step harness work (wiki maintainer, ranker, quality scorer, outreach drafter, dedup judge).
- **CF Workers** for shorter sessions where edge latency matters (e.g. interactive market-definition harness exposed via the web app).

The harness runtime supports both; the application chooses where to run a session based on workload shape.

## When Flue ships a feature we want

ADR `0005-harness-borrow-flue-patterns.md` is the place to record the adaptation: what we took, how we shaped it to our internals, what we left behind. Public surface stays stable; internals evolve.

## V0 / V1 / V2 phasing

- V0: harness contract documented only; no runtime.
- V1: thin custom runtime in [`packages/agents-runtime`](../agents-runtime/agents.md). `virtual` sandbox by default. Wiki maintainer, capture extractor, ranker built on this.
- V2: container sandboxes (`daytona`, `e2b`, etc.) for skills that need real shell.

## Validation criteria

### Public surface (Flue mirror — falsifiability for ADR 0005)
- **Given** the public surface listed under "Mirrored from Flue", **when** any of `init`, `harness.session`, `session.prompt`, `session.task`, `session.skill`, `connectMcpServer` change shape, **then** the change is documented in ADR 0005 and the conformance suite at `packages/agents/src/conformance/harness.suite.ts` is updated. Coverage: PR review checklist + lint. (TBD V1).
- **Given** the V1 runtime, **when** the conformance suite runs, **then** the public surface matches the documented shape (function names, parameter names, return types). Coverage: integration. Test: `packages/agents/src/conformance/harness.suite.ts` (TBD V1).

### Role precedence (hard rule)
- **Given** roles set at harness, session, and call levels, **when** a prompt runs, **then** the call-level role wins, then session, then harness. Coverage: integration. Test: `packages/agents/tests/role-precedence.test.ts` (TBD V1).

### AGENTS.md overlay
- **Given** an `AGENTS.md` in CWD and nested `AGENTS.md` files in subdirectories, **when** a session is scoped under a subdirectory, **then** the system prompt overlay layers from CWD outward to deepest, with deeper overriding shallower for the same key. Coverage: integration. Test: `packages/agents/tests/agents-md-overlay.test.ts` (TBD V1).

### Built-in tool isolation (hard rule)
- **Given** the built-in `filesystem` tool, **when** invoked in production runtime, **then** all I/O routes through `WikiStore` / `EvidenceStore` (no raw `fs` access). Coverage: integration. Test: `packages/agents/tests/no-raw-fs-in-tools.test.ts` (TBD V1).
- **Given** any built-in domain tool that takes `workspaceId`, **when** invoked, **then** workspace-scoping is verified before any data access. Coverage: integration. Test: `packages/agents/tests/builtin-tools-workspace-scoped.test.ts` (TBD V1).

### Result validation
- **Given** any `prompt`/`task`/`skill` call with a result schema, **when** the model output fails validation, **then** the harness retries up to N times feeding the validator's error back as a system message; if N retries fail, a structured error is returned. Coverage: integration. Test: `packages/agents/tests/result-validator-retry.test.ts` (TBD V1).

### MCP
- **Given** an MCP server registered via `connectMcpServer`, **when** a tool from that server is called, **then** the tool surface (name, args schema, result schema) is round-tripped through the harness identical to a built-in tool. Coverage: integration. Test: `packages/agents/tests/mcp-tool-surface.test.ts` (TBD V1).

### Sessions
- **Given** a session bound to a workspace, **when** any session op runs, **then** it is workspace-scoped (no cross-workspace state leakage). Coverage: integration. Test: `packages/agents/tests/session-workspace-scoped.test.ts` (TBD V1).

### Cross-link
- ADR: [`docs/decisions/0005-harness-borrow-flue-patterns.md`](../../docs/decisions/0005-harness-borrow-flue-patterns.md).
- Architecture: [`docs/architecture/harness.md`](../../docs/architecture/harness.md).
