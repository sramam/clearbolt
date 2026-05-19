# `packages/ai`

> Runtime: **both**.

Wraps the Vercel AI SDK with Clearbolt-specific routing, prompt versioning, and the `Embedder` contract.

**Zod** is the single supported schema library here: structured generations (`generateObject` and friends), extraction DTOs, and any payload we round-trip with [`packages/agents`](../agents/agents.md) use `z.ZodTypeAny` / `z.infer<typeof schema>`. Provider strict modes that need JSON Schema use the project's zod→JSON Schema conversion at the call site (same shapes the harness validates).

Cross-cuts [`docs/architecture/ai-usage.md`](../../docs/architecture/ai-usage.md).

## What's in here

- `ModelProvider` — chooses a model per call type (extraction, normalization, wiki-ingest, wiki-query, ranking, outreach drafting). Configured per environment + per workspace overrides.
- **Zod schemas** — per-feature `z` objects under `packages/ai/schemas/<feature>.ts` (or co-located with prompts); used for structured output + shared with harness `result` types where the call originates from an agent session.
- AI Gateway integration in front of every model call (caching, observability, cost attribution per `workspaceId` / feature / prompt-version).
- `Embedder` contract.
- Prompt template loader (`packages/ai/prompts/<feature>/<version>.md`); `.agents/skills/` loader lives in `packages/agents`.
- Eval fixture loader (V2+).

## `Embedder` contract

```ts
interface Embedder {
  name: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
```

V1 default: OpenAI `text-embedding-3-small` (1536 dims, cheap, good quality).

Pluggable: Cohere, Voyage, Workers AI, etc.

## ModelProvider routing

```ts
const model = modelProvider.pick({
  feature: 'wiki-ingest',
  workspaceId,
  hint: 'long-context',     // optional
});

const result = await generateText({ model, ... });
```

Routing rules in `packages/ai/routing.ts`:

- `extraction` -> cheap, fast (e.g. gpt-4o-mini, claude-3-haiku).
- `wiki-ingest` -> mid-tier (e.g. gpt-4o, claude-3.5-sonnet).
- `wiki-query` -> mid-tier with longer context.
- `dedup-judge` / `dedup-llm` -> **cheap** chat (OpenRouter interim in [`packages/dedup`](../dedup/agents.md) via direct API until AI Gateway routes this feature); upgrade path = same contract behind `ModelProvider`.
- `ranking` -> cheap.
- `outreach-draft` -> mid-tier with style consistency.
- `market-definition` -> mid-tier with planner/evaluator pattern (multi-call).

Per-workspace override possible (e.g. enterprise workspace pinned to claude-3.5-sonnet for everything).

## AI Gateway

Single chokepoint for all model calls. Buys us:

- Prompt-cache hits.
- Per-`workspaceId` / `feature` / `prompt-version` cost attribution.
- Latency/error observability.
- Provider failover (cf-down -> fall to next provider).

## Prompt versioning

Every prompt template carries a version. Stored in `MetadataStore` along with derived fields so we can:

- Re-extract any historical record with a newer version.
- Roll back to a prior version on regression.
- Compare versions in evals.

## Where it runs

Both. The Vercel AI SDK runs everywhere; AI Gateway is HTTP-fronted; embeddings are HTTP-fronted. CF Workers and Fly Node call this package identically.

## Validation criteria

### Contracts
- **Given** any `Embedder` backend, **when** the conformance suite runs, **then** `embed([...])` returns `number[][]` with `[i].length === dimensions` and is idempotent for identical inputs (within a tolerance band where the provider is non-deterministic). Coverage: integration. Test: `packages/ai/src/conformance/embedder.suite.ts` (TBD V1).
- **Given** any structured-output call that accepts a Zod schema, **when** the model returns JSON, **then** parsing uses `schema.safeParse(parsed)` and failures trigger the same retry contract as [`packages/agents`](../agents/agents.md) `ResultValidator`. Coverage: integration. Test: `packages/ai/tests/structured-output-zod-retry.test.ts` (TBD V1).
- **Given** any `ModelProvider`, **when** `pick({ feature, workspaceId })` is called twice for the same inputs, **then** the same model is returned (unless an A/B flight is active). Coverage: integration. Test: `packages/ai/tests/model-routing-stable.test.ts` (TBD V1).

### AI Gateway (cost & observability — hard rule)
- **Given** any model call from this package, **when** intercepted at the gateway, **then** the request is tagged with `workspaceId`, `feature`, `promptVersion`, `model`. Coverage: integration. Test: `packages/ai/tests/gateway-tags.test.ts` (TBD V1). Cross-link to [`docs/operations/cost-budgets.md`](../../docs/operations/cost-budgets.md).
- **Given** the AI Gateway is unreachable, **when** a model call would be made, **then** the call falls back to the direct provider with degraded caching and a warning is logged. Coverage: integration. Test: `packages/ai/tests/gateway-fallback.test.ts` (TBD V1).
- **Given** a workspace at its monthly AI budget cap, **when** any model call is attempted, **then** the call is rejected with `BudgetExceededError` before reaching the provider. Coverage: integration. Test: `packages/ai/tests/budget-cap-enforced.test.ts` (TBD V1).

### Prompt versioning
- **Given** any prompt template, **when** loaded via the prompt loader, **then** it carries a `version` string and the version is stored alongside any derived field. Coverage: integration. Test: `packages/ai/tests/prompt-version-stamped.test.ts` (TBD V1).
- **Given** a stored derived field with `promptVersion=N`, **when** re-extraction at version `N+1` is requested, **then** the new value is written and the prior is preserved (versioned). Coverage: integration. Test: `packages/ai/tests/re-extract-preserves-history.test.ts` (TBD V1).

### Eval regression (V2+)
- **Given** any change to a prompt template, model routing, or harness, **when** CI runs, **then** the eval regression suite passes (per-task pass rate ≥ baseline minus tolerance). Coverage: integration + CI gate. Test: `services/evals/tests/regression-suite.test.ts` (TBD V2). Cross-link to [`docs/operations/success-metrics.md`](../../docs/operations/success-metrics.md).

### Cross-runtime
- **Given** the same prompt + same model + same workspace, **when** invoked from a CF Worker and from a Fly Node process, **then** the result is functionally equivalent (same tagging, same caching). Coverage: integration. Test: `packages/ai/tests/cross-runtime-equivalence.test.ts` (TBD V1).

### Cross-link
- Architecture: [`docs/architecture/ai-usage.md`](../../docs/architecture/ai-usage.md).
