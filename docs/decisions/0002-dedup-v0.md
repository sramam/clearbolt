# ADR 0002 — V0 dedup: deterministic + lexical only, compositional Scorer

Status: accepted

## Context

V0 is a local-dev walking skeleton with no AI / no embeddings / no LLM call budget. We still need cross-source deduplication to be a first-class product feature from day one — searchers should not see the same listing three times.

V1 will introduce vector embeddings and (optionally) LLM-judge for uncertain pairs. V0 must not block that addition.

## Decision

V0 ships a **compositional `Scorer`** with deterministic + lexical contributors only:

- `deterministic` — exact-match keys (URL, external listing ID, broker+listing ID, normalized phone, normalized email).
- `lexical` — token Jaccard on normalized title; first N chars of description.
- `numeric` — tolerance on asking price, revenue, cash flow, EBITDA.
- `geo` — agreement on state / MSA / city / postal.

Top-level score is a weighted sum of contributor scores. Weights are configurable per workspace.

Sub-threshold candidate pairs (`MergeCandidate` rows) are persisted in `MetadataStore` so V1's vector pass can re-evaluate them without re-scanning all source records.

V1 adds a `vector` contributor (and optionally `llm-judge`) without rewriting prior contributors or changing the consumer API. Compositional shape makes vector additive.

## Consequences

- V0 dedup runs entirely without paid API calls.
- Dedup recall is lower than it will be in V1 (rewritten/syndicated descriptions across sites can fool lexical-only matching).
- The persisted `MergeCandidate` queue means V1 vector pass catches the historical misses without a full re-scan — important because re-scanning a year of history at scale would be expensive.
- New scorers (any future signal) plug in the same way.

## Falsifiability criteria

- **Trigger**: V0 dedup recall (correctly-merged-pairs / actual-merge-pairs) on the known-pairs golden set drops below 80%.
  **Measurement**: `packages/dedup/tests/fixtures/known-pairs.ts` regression run on every commit.
  **Response**: tighten lexical normalization, add a deterministic key, or accept that V0 recall is "good enough" and rely on V1's vector pass to catch misses (acceptable if `MergeCandidate` queue absorbs the borderline cases).
- **Trigger**: V0 dedup precision (correctly-auto-merged / total-auto-merged) drops below 95%.
  **Measurement**: golden set + sampled human review of auto-merges in V1.
  **Response**: raise auto-merge threshold (V0 default `>=0.85`); more pairs land in the review queue rather than auto-merging.
- **Trigger**: `MergeCandidate` queue grows faster than V1's vector pass can re-evaluate it (queue depth doubles week-over-week sustained).
  **Measurement**: queue-depth metric in `packages/observability` `MetricsSink`.
  **Response**: tune borderline thresholds, or accept that some pairs persist as "unresolved" and surface them in operator review UI.
- **Trigger**: a new contributor (vector, llm-judge, or a future signal) requires changes to existing contributors or the consumer API.
  **Measurement**: PR review.
  **Response**: revisit the compositional design; the abstraction is failing.
