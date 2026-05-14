# `packages/agents-runtime`

> Runtime: **both** (node + workers). Multi-target build matches Flue's pattern.

The thin custom implementation of the harness contract defined in [`packages/agents`](../agents/agents.md).

## Responsibilities

- Implement `init`, `Harness`, `Session`, `session.prompt/task/skill`, `connectMcpServer`.
- Manage session state (turns, tool calls, schema-validated outputs, token usage).
- Route model calls through `packages/ai`'s `ModelProvider` (Vercel AI SDK + AI Gateway).
- Load `AGENTS.md` and `.agents/skills/<name>.md` from CWD upward.
- Apply role precedence: `call > session > harness`.
- Drive the `Sandbox` (from [`packages/agents-sandboxes`](../agents-sandboxes/agents.md)) for tool execution.
- Persist session state via `SessionStore`.
- Validate result schemas with `ResultValidator`.

## Build matrix

```
Source: TypeScript ESM
Targets:
  node    -> dist/node/...    (Fly.io workers)
  workers -> dist/workers/... (CF Workers)
```

Targets share 95%+ of code. Differences:

- File I/O (`AGENTS.md` discovery, skills loading): node uses `fs/promises`; workers receive pre-loaded skills via `init({ skills: [...] })`.
- HTTP transport for MCP: both use `fetch`; workers prefer the global, node uses `undici`.
- Crypto for content-addressing: both use Web Crypto.

## Internals (not the public surface)

- `Turn` — one round-trip with the model: input messages, model call, tool calls, validation, output.
- `ToolRegistry` — combined registry of built-in tools + `init`-registered tools + MCP tools.
- `MessageStream` — streaming model output; supports incremental `data` validation when the schema is structured.
- `Tracer` integration ([`packages/observability`](../observability/agents.md)) — every prompt/task/skill emits a span.
- Cost stamping — each turn records token usage and cost; aggregated at session-end and stamped on harness artifacts.

## V1 ship list

- `init` + `Harness` + `Session`.
- `prompt`, `task`, `skill`.
- `AGENTS.md` + `.agents/skills/` discovery (node target).
- Built-in tools registered.
- `virtual` sandbox.
- Postgres `SessionStore`.
- **Zod** `ResultValidator` (same `zod` dependency / schema shapes as [`packages/ai`](../ai/agents.md) where calls chain into `ModelProvider`).
- MCP HTTP + SSE transport.

## V2 ship list

- Cloudflare Durable Objects `SessionStore` adapter.
- Container sandbox providers wired in (handed off to `packages/agents-sandboxes`).
- Streaming partial-`data` validation.

## Validation criteria

### Conformance to the harness contract
- **Given** the runtime in this package, **when** the conformance suite from [`packages/agents`](../agents/agents.md) runs, **then** all assertions pass for both the `node` and `workers` build targets. Coverage: integration. Test: `packages/agents-runtime/tests/conformance.test.ts` (TBD V1).

### Build matrix
- **Given** the source TypeScript, **when** built, **then** both `dist/node/` and `dist/workers/` outputs are produced and pass an import-smoke test in their respective runtimes. Coverage: smoke. Test: `packages/agents-runtime/tests/build-matrix-smoke.test.ts` (TBD V1).
- **Given** the `workers` target, **when** loaded, **then** it does not pull in `fs/promises` or any node-only dep (verified by import scan). Coverage: lint. Test: `packages/agents-runtime/tests/no-node-deps-in-workers.test.ts` (TBD V1).

### Turn semantics
- **Given** a `Turn`, **when** the model returns a tool call, **then** the call is dispatched, the result is fed back to the model, and the loop continues until either a final result is returned or a configured max-turns cap is hit. Coverage: integration. Test: `packages/agents-runtime/tests/turn-loop.test.ts` (TBD V1).
- **Given** the max-turns cap, **when** hit, **then** a structured `MaxTurnsExceededError` is returned (not a silent timeout). Coverage: integration. Test: `packages/agents-runtime/tests/max-turns-error.test.ts` (TBD V1).

### Cost stamping (hard rule)
- **Given** any `prompt`/`task`/`skill` call, **when** complete, **then** token usage and cost are recorded per-turn and aggregated at session-end onto the harness artifact. Coverage: integration. Test: `packages/agents-runtime/tests/cost-stamped.test.ts` (TBD V1). Cross-link to [`docs/operations/cost-budgets.md`](../../docs/operations/cost-budgets.md).

### Tracing
- **Given** any `prompt`/`task`/`skill` call, **when** invoked, **then** an OTel span is emitted via `packages/observability` with `feature`, `workspaceId`, `model`, `promptVersion`, `costUsd`, `outcome` attributes. Coverage: integration. Test: `packages/agents-runtime/tests/span-attributes.test.ts` (TBD V1).

### Sandbox driving
- **Given** any tool call, **when** dispatched, **then** it is routed through the configured `Sandbox` (the runtime never executes shell / subprocess directly). Coverage: integration. Test: `packages/agents-runtime/tests/no-direct-shell.test.ts` (TBD V1).
