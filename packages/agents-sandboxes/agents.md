# `packages/agents-sandboxes`

> Runtime: depends on backend (most are node).

Sandbox backends for the harness. Each backend implements the `Sandbox` interface from [`packages/agents`](../agents/agents.md).

## Backends

### `virtual` (in-process)

- Default. No subprocess, no shell, no network beyond what tools allow.
- Tool calls execute synchronously via the harness's `ToolRegistry`.
- Best for: most production work. The wiki maintainer, capture extractor, dedup judge, ranker all run here.
- Runtime: **both** (node + workers).

### `local-node`

- Spawns a Node subprocess for skills that need shell.
- Filesystem isolated to a sandbox directory; agent cannot escape.
- No network unless the spawned process explicitly opens it.
- Runtime: **node** only.

### `daytona`

- Daytona dev-environment provider for skills that need a full shell + filesystem + arbitrary tools.
- Pricing per workspace-hour; gated by per-workspace budgets.
- Runtime: **node** (the Daytona client lives on Fly).

### `e2b`

- E2B code-interpreter sandboxes; good for skills that need Python / shell with isolation.
- Runtime: **node**.

### `vercel-sandbox`

- Vercel's serverless code-execution sandbox.
- Runtime: **node**.

## Selecting a sandbox

```ts
const harness = await init({
  ...,
  sandbox: 'virtual',                  // default
  // or
  sandbox: { kind: 'local-node', root: '/tmp/clearbolt-sandbox' },
  // or
  sandbox: { kind: 'daytona', workspaceImage: 'clearbolt/agent:v1' },
});
```

## Phasing

- V0: not needed.
- V1: ship `virtual` only. Built-in tools cover all production work.
- V2: ship `local-node` + first container provider (`daytona` likely) for skills that need real shell (e.g. exploratory diligence skills the user runs interactively).

## Why this is a separate package

- `daytona`, `e2b`, `vercel-sandbox` are heavy / paid deps that V0 / V1 do not need.
- Keeping them out of `packages/agents-runtime` means the V1 build is small and fast on Workers.
- Adding a new sandbox provider is a sibling package addition, not a runtime refactor.

## Validation criteria

### Conformance
- **Given** any `Sandbox` backend listed above, **when** the conformance suite at `packages/agents-sandboxes/src/conformance/sandbox.suite.ts` runs, **then** all assertions pass: tool dispatch returns a structured result, errors propagate as typed `SandboxError`, and the sandbox is teardown-clean (no leaked subprocesses or temp dirs). Coverage: integration. Test: `packages/agents-sandboxes/tests/conformance.test.ts` (TBD V1).

### `virtual` (V1)
- **Given** the `virtual` sandbox, **when** any tool is dispatched, **then** no subprocess is spawned and no shell is invoked (verified via `child_process` mock). Coverage: integration. Test: `packages/agents-sandboxes/tests/virtual-no-subprocess.test.ts` (TBD V1).
- **Given** the `virtual` sandbox, **when** built for the `workers` target, **then** it has zero node-only dependencies. Coverage: lint. Test: `packages/agents-sandboxes/tests/virtual-workers-no-node-deps.test.ts` (TBD V1).

### `local-node` (V2)
- **Given** the `local-node` sandbox with a configured `root`, **when** a spawned tool tries to write outside `root`, **then** the write is rejected. Coverage: integration. Test: `packages/agents-sandboxes/tests/local-node-fs-jail.test.ts` (TBD V2).
- **Given** the `local-node` sandbox, **when** the host process exits, **then** all spawned subprocesses are reaped (no zombies). Coverage: integration. Test: `packages/agents-sandboxes/tests/local-node-no-zombies.test.ts` (TBD V2).

### Container providers (V2+)
- **Given** any container provider (`daytona`/`e2b`/`vercel-sandbox`), **when** invoked beyond the per-workspace budget, **then** the call is rejected with `BudgetExceededError`. Coverage: integration. Test: `packages/agents-sandboxes/tests/container-budget.test.ts` (TBD V2).
- **Given** any container session, **when** the harness session ends, **then** the container is torn down within a configured TTL. Coverage: integration. Test: `packages/agents-sandboxes/tests/container-teardown.test.ts` (TBD V2).

### Runtime annotations
- **Given** any backend in this package, **when** registered, **then** it declares its `runtime` (`node` | `workers` | `both`); the harness refuses to use a backend whose runtime does not match the host. Coverage: integration. Test: `packages/agents-sandboxes/tests/runtime-mismatch-rejected.test.ts` (TBD V1).
