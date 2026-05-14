# `packages/dedup`

> Runtime: **both**. Compositional `Scorer` so V1's vector contributor lands additively.

Defines the dedup contracts and ships the V0 deterministic + lexical pipeline. Cross-cuts [`docs/architecture/dedup.md`](../../docs/architecture/dedup.md). ADR: [`docs/decisions/0002-dedup-v0.md`](../../docs/decisions/0002-dedup-v0.md).

## Contracts

### `DedupKeyer`

```ts
interface DedupKeyer {
  keys(record: SourceRecord): DedupKey[];
}

type DedupKey =
  | { kind: 'url'; value: string }
  | { kind: 'external'; adapter: string; externalId: string }
  | { kind: 'broker-listing'; brokerKey: string; externalId: string }
  | { kind: 'phone'; e164: string }
  | { kind: 'email'; lower: string }
  | { kind: 'geo-price'; state: string; cityOrMsa: string; priceBucket: string; cashflowBucket: string }
  | { kind: 'title-fingerprint'; sha: string };
```

V0 ships per-adapter keyers that produce a stable bag of keys per source.

### `Scorer` (compositional)

```ts
interface ScoreContributor {
  name: string;
  defaultWeight: number;
  score(a: SourceRecord, b: SourceRecord, ctx: ScoreContext): Promise<number>;  // [0, 1]
}

interface Scorer {
  contributors: ScoreContributor[];
  weights: Record<string, number>;
  score(a: SourceRecord, b: SourceRecord): Promise<{
    overall: number;
    breakdown: Record<string, number>;
  }>;
}
```

V0 contributors:

- `deterministic` — exact-match keys collapse to score 1.0.
- `lexical` — token Jaccard on normalized title; first N chars of description.
- `numeric` — tolerance on asking price, revenue, cash flow, EBITDA (e.g. within 10%).
- `geo` — agreement on state / MSA / city / postal.

V1+ contributors:

- `vector` — cosine similarity on `CanonicalDealEmbedding` (pgvector via [`packages/storage-neon`](../storage-neon/agents.md)).
- `llm-judge` (optional) — calls a small `dedup-judge` skill via [`packages/agents`](../agents/agents.md) for uncertain pairs that need explanation.

Weights are configurable per workspace (`MetadataStore.dedupConfig`) so different workspaces can tune.

### `MergeDecider`

```ts
interface MergeDecider {
  decide(score: { overall: number; breakdown: Record<string, number> }):
    'auto_merge' | 'review' | 'new';
}
```

V0 default thresholds: `auto_merge >= 0.85`, `review in [0.55, 0.85)`, `new < 0.55`. Tunable. Persisted per workspace.

## V0 pipeline

1. `DedupKeyer.keys(record)` -> bag of keys.
2. Lookup `MetadataStore.dedupIndex` for any matching keys -> candidate `CanonicalDeal`s.
3. For each candidate, run `Scorer.score(newRecord, existingCanonical.representative)`.
4. `MergeDecider.decide(score)` -> action:
   - `auto_merge` -> attach as new `SourceRecord` on the existing canonical; update `lastObservedAt`, `sources[]`, field provenance.
   - `review` -> persist a `MergeCandidate { workspaceId?, sourceRecordId, candidateCanonicalId, score, breakdown, decidedAt: null }` row and surface in a review queue.
   - `new` -> create a fresh `CanonicalDeal`. **Persist `MergeCandidate` rows for sub-threshold pairs we considered** so V1's vector contributor can re-evaluate without a full re-scan.

Multi-source preservation: we never delete `SourceRecord`s. Dedup attaches sources to canonicals. ADR: [`docs/decisions/0003-multi-source-preservation.md`](../../docs/decisions/0003-multi-source-preservation.md).

## V1 layered re-evaluation

Once `vector` contributor lands:

1. Recompute scores for all `MergeCandidate` rows whose `decidedAt` is null and whose original `breakdown` was missing the `vector` key.
2. Promote candidates that now exceed the `auto_merge` threshold to merged status.
3. Update breakdowns; surface the diff for operator review.

This is why V0 captures sub-threshold pairs as `MergeCandidate`s rather than dropping them. The compositional shape means vector is purely additive.

## Where it runs

- V0: in-process with the scraper.
- V1+: as a queue-consumer worker on Fly that runs after each new source record. CF Workers can run lighter `Scorer` calls (deterministic + numeric + geo) for synchronous read-side dedup checks; lexical + vector live on Fly with full DB access.

## Validation criteria

### Contracts
- **Given** any `DedupKeyer` backend, **when** the conformance suite runs, **then** keys are stable across runs for the same input (same record → same key bag). Coverage: integration. Test: `packages/dedup/src/conformance/keyer.suite.ts` (TBD V0).
- **Given** any `Scorer` backend, **when** the conformance suite runs, **then** `overall ∈ [0, 1]`, `breakdown` keys match registered `contributors`, and weights sum to 1.0 (or are normalized). Coverage: integration. Test: `packages/dedup/src/conformance/scorer.suite.ts` (TBD V0).
- **Given** any `MergeDecider`, **when** fed `(overall, breakdown)` triples from the golden corpus, **then** decisions match labels within the tolerance window. Coverage: golden-set. Test: `packages/dedup/src/conformance/merge-decider.suite.ts` (TBD V0).

### Compositionality (contributor additivity)
- **Given** the V0 contributor set `{deterministic, lexical, numeric, geo}`, **when** a `vector` contributor is added in V1, **then** existing `MergeCandidate` rows can be re-scored without rewriting any contributor or rerunning the V0 pipeline. Coverage: integration. Test: `packages/dedup/tests/vector-additive.test.ts` (TBD V1). Falsifiability for the compositional Scorer design.

### Functional
- **Given** two source records with an identical `external` key, **when** dedup runs, **then** the deterministic contributor returns 1.0 and `MergeDecider` returns `auto_merge`. Coverage: integration. Test: `packages/dedup/tests/deterministic-collapse.test.ts` (TBD V0).
- **Given** two source records with sub-threshold overall score, **when** dedup runs, **then** a `MergeCandidate` row is persisted and the canonical record is *not* merged. Coverage: integration. Test: `packages/dedup/tests/sub-threshold-persisted.test.ts` (TBD V0). This is the seam V1's vector pass relies on.
- **Given** any `auto_merge` decision, **when** a user later splits the canonical, **then** a `MergeCandidate` records the disagreement, and the originating signal's effective weight is downweighted in subsequent runs. Coverage: integration. Test: `packages/dedup/tests/split-feedback-loop.test.ts` (TBD V1).

### Correctness thresholds (golden-set on V1+ real data)
- **Given** the dedup pipeline running on the labeled golden corpus, **when** evaluated, **then** **false-merge rate** ≤ 1% and **missed-merge rate** (true duplicates not surfaced) ≤ 5%. Coverage: golden-set. Test: `packages/dedup/tests/golden-corpus.test.ts` (TBD V1). Triggers ADR 0002 falsifiability if breached.

### Multi-source preservation (hard rule)
- **Given** any auto-merge or manual merge, **when** complete, **then** zero `SourceRecord` rows are deleted; sources are attached to canonicals. Coverage: integration. Test: `packages/dedup/tests/sources-never-deleted.test.ts` (TBD V0). Cross-link to [ADR 0003](../../docs/decisions/0003-multi-source-preservation.md).

### Cross-link
- Architecture: [`docs/architecture/dedup.md`](../../docs/architecture/dedup.md).
- ADR: [`docs/decisions/0002-dedup-v0.md`](../../docs/decisions/0002-dedup-v0.md), [`0011`](../../docs/decisions/0011-vector-pgvector-on-neon-v1.md) for vector seam.
