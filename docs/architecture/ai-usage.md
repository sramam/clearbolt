# AI Usage

Use the **Vercel AI SDK** (wrapped by [`packages/ai`](../../packages/ai/agents.md)) for all model calls. Use the agent harness ([harness.md](harness.md)) for any multi-step work or tool use.

## Where AI is used

- Extracting facts from messy listing text.
- Normalizing industries and business types.
- Explaining why records may be duplicates (LLM-judge contributor in the dedup `Scorer`).
- Drafting and revising market definitions from buyer interviews and examples.
- Summarizing deal highlights and risks.
- Producing quality-of-deal summaries with explicit evidence and gaps.
- Mapping a searcher's thesis to ranking signals.
- Explaining how likes/dislikes and passes affected a workspace's search results.
- Explaining purchase-capacity fit and financing assumptions in plain language.
- Universal clipper extraction (HTML/markdown -> structured fields).
- Wiki maintainer ingest/query/lint.
- Transcript-derived summaries.
- Identifying missing diligence fields.
- Drafting outreach only from user-approved context, with review before send.
- Summarizing call notes, replies, and next actions.
- Later: matching deal-team needs to provider specialties only after user consent.

## What AI does not do

Do not use models to invent financials, contact details, legal identity, or financing eligibility. If a field comes from AI extraction, store the source snippet or payload reference that supports it.

Models do not silently merge canonical records. Dedup with AI-judge confidence below the auto-merge threshold goes to human review.

## Routing

`packages/ai` adds Clearbolt-specific routing on top of the Vercel AI SDK:

- `ModelProvider` chooses a model per call type (extraction, normalization, wiki-ingest, wiki-query, ranking, outreach drafting).
- AI Gateway sits in front for caching, observability, cost attribution.
- Per-workspace budget enforcement at this layer.

## Prompt versioning

Every prompt template (in `packages/ai/prompts/` or `.agents/skills/`) carries a version. Derived fields stamped with the prompt version that produced them. Re-extraction jobs can target a specific version.

`TODO:` Add prompt versioning, eval fixtures, and structured output schemas.

## AI Evaluation Harness

AI features regress silently. Build evals before scaling AI surface area.

Components:

- **Golden sets** per task: extraction, dedup-pair classification, market-definition drafting, quality-of-deal scoring, outreach drafting, wiki-ingest, wiki-query.
- **Regression suite** runs on every model/prompt change; CI gate for high-impact tasks.
- **Evaluator agents** (per the harness pattern) grade subjective outputs against explicit criteria.
- **Human review queue** for low-confidence cases and disagreements between evaluator and ground truth.
- **Live sampling**: periodically grade a percentage of production outputs to detect drift.
- **Cost/latency tracking** per task and prompt version.

Reporting:

- Per-task pass rate, drift over time, evaluator-vs-human agreement.
- Tied to prompt version, model version, and harness version.

`TODO:` Decide whether to build this on the chosen agent harness or as a separate `eval` package; integrate into CI.

## Validation criteria

### Functional
- **Given** any AI extraction call, **when** a structured field is extracted, **then** the source snippet (or evidence reference) backing the field is stored alongside it in `fieldProvenance`. Coverage: integration. Test: `packages/ai/tests/extraction-stores-provenance.test.ts` (TBD V1).
- **Given** any prompt template, **when** it is invoked, **then** the model call records the `promptVersion` and that version stamps every derived field (re-extraction by version is possible). Coverage: integration. Test: `packages/ai/tests/prompt-version-stamped.test.ts` (TBD V1).
- **Given** the AI Gateway is configured with caching, **when** the same prompt is invoked twice, **then** the second call hits the cache (verified by gateway log) and stamps `cacheHit: true` on the resulting `agent.llm_called` event. Coverage: integration. Test: `packages/ai/tests/gateway-cache-hit.test.ts` (TBD V1).

### Routing
- **Given** an extraction task vs. a wiki-ingest task vs. a ranking task, **when** `ModelProvider.choose()` runs, **then** it returns different models per the V1 routing table (extraction → cheap+fast; wiki-ingest → quality; ranking → balanced). Coverage: unit. Test: `packages/ai/tests/model-routing.test.ts` (TBD V1).
- **Given** a per-workspace AI budget, **when** a model call would exceed the cap, **then** the call is rejected with `BudgetExceededError` and the workspace owner is notified. Coverage: integration. Test: `packages/ai/tests/budget-cap-enforced.test.ts` (TBD V1).

### Quality / evals
- **Given** the V2 eval golden set for any task, **when** the regression runs, **then** the pass rate ≥ the previous baseline minus the configurable drift tolerance. Coverage: golden-set + CI gate. Test: `services/evals/tests/regression-suite.test.ts` (TBD V2).
- **Given** any production AI output, **when** the live sampling job runs, **then** at least 1% of outputs are graded by an evaluator agent and the drift score is updated. Coverage: integration. Test: `services/evals/tests/live-sampling.test.ts` (TBD V2).

### Failure modes
- **Given** a low-confidence dedup pair (LLM-judge confidence below auto-merge threshold), **when** dedup runs, **then** the pair lands in the human-review queue and is not auto-merged. Coverage: integration. Test: `packages/dedup/tests/llm-judge-uncertain-routes-to-review.test.ts` (TBD V1).
- **Given** an AI extraction returns a financial number with no source snippet, **when** the result is post-processed, **then** the field is rejected (no source = no field). Coverage: unit. Test: `packages/ai/tests/extraction-rejects-unsourced-numerics.test.ts` (TBD V1).

### Closed loop into improvement
- **Given** two prompt versions live behind a feature flag, **when** users interact with each cohort over 30 days, **then** the agent platform team can compute funnel-rate delta (e.g., `listing.saved` per `listing.viewed`) per cohort with a single SQL query against PostHog. Coverage: integration. Test: `services/evals/tests/cohort-comparison-query.test.ts` (TBD V2).
