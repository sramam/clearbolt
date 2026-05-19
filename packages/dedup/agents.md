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

**BizBuySell (`BizBuySellDedupKeyer`):** when `SourceRecord.externalId` is set (listing number from the URL), the key bag is **`external` (bizbuysell + id) before `url`**. `ingestSourceRecord` looks up keys in that order (external / broker-listing first, then URL). Both keys are still indexed on attach so www vs `m.` and URL changes keep resolving to the same canonical.

**Discovery vs ingest:** catalog walks in [`packages/scraper`](../scraper/adapters/bizbuysell/agents.md) dedupe refs in memory by listing id only; persistence and `contentUpdated` always go through `ingestSourceRecord` below.

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

V0 contributors (programmatic `scorePair` / async `scorePairAsync` baseline):

- **Deterministic** — not a weighted contributor: `DedupKeyer` + `MetadataStore` dedup index (`url`, `external`, …). Exact key hit attaches without running lexical/numeric/geo against candidates.
- `lexical` — token Jaccard on normalized title (description text lands in V1 extraction richness).
- `numeric` — tolerance on asking price, revenue, cash flow (when present).
- `geo` — agreement on state (V0 minimal).

**Listing body fingerprint + optional embeddings**

- `SourceRecord.bodyFingerprint` — sha256 of normalized visible HTML text (see [`packages/scraper`](../scraper/agents.md) `htmlListingBodyFingerprint`). Set on CLI scrape for **re-scrape update detection**: when a new source **merges** onto an existing canonical (via any matching dedup key, including listing number), `ingestSourceRecord` returns `contentUpdated: true` only if `bodyFingerprint` differs from the canonical’s **representative** source; same fingerprint → `contentUpdated: false`. Each scrape still appends a new `SourceRecord` (multi-source preservation).
- **OpenRouter embeddings** — [`openrouter-embed.ts`](src/openrouter-embed.ts) calls `POST https://openrouter.ai/api/v1/embeddings` (OpenAI-compatible). **`CLEARBOLT_DEDUP_EMBED_MODEL`** pins a model; **when unset**, [`openrouter-resolve-embed-model.ts`](src/openrouter-resolve-embed-model.ts) reads the public [`GET /api/v1/embeddings/models`](https://openrouter.ai/docs/api/api-reference/embeddings/list-embeddings-models) list (no key required), prefers **`DEDUP_FREE_EMBED_MODEL_PREFERENCES`** (e.g. Nemotron embed `:free` when present), then any other **zero-priced** text→embeddings model, then **lowest `pricing.prompt`** (per-million) paid model (tie-break: shorter id). Catalog hits are **cached** (`CLEARBOLT_DEDUP_EMBED_MODEL_LIST_TTL_MS`, else `CLEARBOLT_DEDUP_LLM_MODEL_LIST_TTL_MS`, default 6h). List/network failure falls back to **`openai/text-embedding-3-small`**. **`CLEARBOLT_DEDUP_EMBED=1`** on the CLI enables one embedding per scraped listing (requires `OPENROUTER_API_KEY`). When **both** records carry `bodyEmbedding` of the same dimension, `scorePair` / `scorePairAsync` add an **`embedding`** breakdown (cosine mapped to `[0,1]`, blended into overall). V1+ should move long vectors to pgvector ([ADR 0011](../../docs/decisions/0011-vector-pgvector-on-neon-v1.md)) and keep only refs on `SourceRecord`.

**Optional OpenRouter blend:** when `OPENROUTER_API_KEY` is set, `scorePairAsync` (used by `ingestSourceRecord`) blends in **`llm`** from [`scorer-llm-openrouter.ts`](src/scorer-llm-openrouter.ts): a single chat completion on OpenRouter returning JSON `{"p_same":0..1}`. **`CLEARBOLT_DEDUP_LLM_MODEL`** forces a specific model; **when unset**, the implementation calls the public [OpenRouter models catalog](https://openrouter.ai/api/v1/models) (no key required), picks a **zero-priced text** model, and prefers slugs listed in [`openrouter-resolve-dedup-model.ts`](src/openrouter-resolve-dedup-model.ts) (`DEDUP_FREE_MODEL_PREFERENCES`, e.g. Gemma 4 26B free, Nemotron nano free, Qwen coder free, …). Catalog results are **cached** (`CLEARBOLT_DEDUP_LLM_MODEL_LIST_TTL_MS`, default 6h). If catalog resolution fails, it falls back to **`meta-llama/llama-3.2-1b-instruct`** (tiny paid). Weight via `CLEARBOLT_DEDUP_LLM_WEIGHT` (default `0.3`). **CI:** repository secret **`OPENROUTER_API_KEY`** is **required** — `scripts/verify-openrouter-ci-secret.mjs` fails the workflow if missing; `pnpm test` runs live network tests in `packages/dedup/tests/openrouter-dedup.live.test.ts`. Workflow pins **`CLEARBOLT_DEDUP_LLM_MODEL=google/gemma-4-26b-a4b-it:free`** for stable chat completions. Local dev without the key skips live tests; with the key in `.env.cloud.local`, they run. Revisit preferences as OpenRouter rotates free tiers ([model list UI](https://openrouter.ai/models?output_modalities=text&order=pricing-low-to-high)).

V1+ contributors:

- `vector` — cosine similarity on `CanonicalDealEmbedding` (pgvector via [`packages/storage-neon`](../storage-neon/agents.md)).
- `llm-judge` (optional) — richer `dedup-judge` skill via [`packages/agents`](../agents/agents.md) for uncertain pairs that need explanation (separate from the cheap OpenRouter blend above).

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

## Listing fetch cooldown (scrape / catalog ingest)

Scrape pipelines call **`shouldSkipListingFetch`** before fetching listing HTML so catalog resumes do not hammer unchanged pages.

- **`listingFetchMinIntervalMs()`** — default 24h; override with `CLEARBOLT_LISTING_FETCH_MIN_INTERVAL_MS`, `CLEARBOLT_LISTING_FETCH_COOLDOWN_HOURS`, or disable with `CLEARBOLT_LISTING_FETCH_COOLDOWN=0`.
- **`listingFetchSkipKnown()`** — when `CLEARBOLT_LISTING_FETCH_SKIP_KNOWN=1`, skip any listing that already resolves to a canonical via `DedupKeyer` keys.
- **`latestListingFetchAt`** — max `lastSeenAt` among sources on the canonical for that listing.
- Implementation: [`listing-fetch-cooldown.ts`](src/listing-fetch-cooldown.ts). Per-listing resume files on disk/R2: [`packages/scraper`](../scraper/agents.md) `listing-ingest-state/`.

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

### OpenRouter free-model resolution
- **Given** a mocked `GET https://openrouter.ai/api/v1/models` whose `data` includes `google/gemma-4-26b-a4b-it:free` as a zero-priced text model, **when** `resolveFreeDedupOpenRouterModel` runs, **then** it returns that id. Coverage: unit. Test: `packages/dedup/tests/openrouter-resolve-dedup-model.test.ts::prefers DEDUP_FREE_MODEL_PREFERENCES when catalog contains them`.
- **Given** a mocked catalog with no preference hits but two heuristic `:free` text models, **when** `resolveFreeDedupOpenRouterModel` runs, **then** it returns the shorter id (deterministic tie-break). Coverage: unit. Test: `packages/dedup/tests/openrouter-resolve-dedup-model.test.ts::falls back to shortest heuristic :free slug when no preference matches`.

### OpenRouter embedding catalog resolution
- **Given** a mocked `GET https://openrouter.ai/api/v1/embeddings/models` whose `data` includes a preferred free slug and a cheaper paid slug, **when** `resolveDedupEmbedOpenRouterModel` runs, **then** it returns the preferred free id. Coverage: unit. Test: `packages/dedup/tests/openrouter-resolve-embed-model.test.ts::prefers DEDUP_FREE_EMBED_MODEL_PREFERENCES when catalog lists it`.
- **Given** a mocked catalog with no free text embedding models but two paid models at different `pricing.prompt`, **when** `resolveDedupEmbedOpenRouterModel` runs, **then** it returns the cheapest id. Coverage: unit. Test: `packages/dedup/tests/openrouter-resolve-embed-model.test.ts::picks cheapest paid when no free text embedding`.
- **Given** a mocked HTTP non-OK response from the embeddings models list, **when** `resolveDedupEmbedOpenRouterModel` runs, **then** it returns `openai/text-embedding-3-small`. Coverage: unit. Test: `packages/dedup/tests/openrouter-resolve-embed-model.test.ts::falls back when embeddings list HTTP fails`.

### Optional OpenRouter blend
- **Given** `OPENROUTER_API_KEY` is unset, **when** `scorePairAsync` runs, **then** its result equals `scorePair` for the same pair. Coverage: unit. Test: `packages/dedup/tests/scorer-async-openrouter.test.ts::matches scorePair when OPENROUTER_API_KEY is unset`.
- **Given** `OPENROUTER_API_KEY` is set and OpenRouter returns `{"p_same":1}`, **when** `scorePairAsync` runs with `CLEARBOLT_DEDUP_LLM_WEIGHT=0.5`, **then** `breakdown.llm` is `1` and `overall` exceeds the programmatic-only `overall`. Coverage: unit. Test: `packages/dedup/tests/scorer-async-openrouter.test.ts::blends LLM p_same when OpenRouter returns JSON`.

### Body fingerprint + ingest updates
- **Given** a first source with `bodyFingerprint` A ingested as new, **when** a second source shares the same dedup keys and `bodyFingerprint` B ≠ A, **when** `ingestSourceRecord` runs, **then** `contentUpdated` is `true`. Coverage: integration. Test: `packages/dedup/tests/ingest-content-updated.test.ts`.
- **Given** `BizBuySellDedupKeyer` and a record with `externalId`, **when** `keys(record)` runs, **then** the first key is `{ kind: 'external', adapter: 'bizbuysell', externalId }` and the second is `{ kind: 'url', … }`. Coverage: unit. Test: `packages/dedup/tests/bizbuysell-keyer.test.ts`.
- **Given** a canonical created from a www listing URL, **when** a second source shares the same `externalId` on a mobile URL with the same `bodyFingerprint`, **when** `ingestSourceRecord` runs, **then** `action` is `merged`, `canonicalId` is unchanged, and `contentUpdated` is `false`; **when** a third source shares the id with a different fingerprint, **then** `contentUpdated` is `true`. Coverage: integration. Test: `packages/dedup/tests/ingest-listing-id-merge.test.ts`.
- **Given** two sources with the same `externalId` but different regional listing URLs, **when** `ingestSourceRecord` runs on the second, **then** it merges onto the first canonical and both source ids appear on the deal. Coverage: integration. Test: `packages/dedup/tests/multi-source-attachment.test.ts`.

### OpenRouter embeddings API
- **Given** `OPENROUTER_API_KEY` is empty or whitespace-only, **when** `embedTextOpenRouter` runs, **then** it resolves to `null` (no network). Coverage: unit. Test: `packages/dedup/tests/openrouter-embed.test.ts::returns null when OPENROUTER_API_KEY is empty`.
- **Given** a mocked `POST https://openrouter.ai/api/v1/embeddings` returning `data` rows in non-index order, **when** `embedTextsOpenRouter` runs, **then** returned vectors are sorted by `index`. Coverage: unit. Test: `packages/dedup/tests/openrouter-embed.test.ts::parses embedding response`.

### Pairwise embedding score
- **Given** two records with identical 3-dim `bodyEmbedding`, **when** `scorePair` runs, **then** `breakdown.embedding` is 1 (within float tolerance). Coverage: unit. Test: `packages/dedup/tests/scorer-embedding.test.ts`.

### Listing fetch cooldown
- **Given** default cooldown env, **when** `listingFetchMinIntervalMs` runs, **then** it returns 24h in ms. Coverage: unit. Test: `packages/dedup/tests/listing-fetch-cooldown.test.ts`.
- **Given** a canonical whose representative was seen within the cooldown window, **when** `shouldSkipListingFetch` runs, **then** it returns true. Coverage: integration. Test: `packages/dedup/tests/listing-fetch-cooldown.test.ts`.
- **Given** `CLEARBOLT_LISTING_FETCH_SKIP_KNOWN=1` and an existing canonical for the listing keys, **when** `shouldSkipListingFetch` runs, **then** it returns true without comparing timestamps. Coverage: integration. Test: `packages/dedup/tests/listing-fetch-cooldown.test.ts`.

### OpenRouter CI gate
- **Given** `CI=true` and `OPENROUTER_API_KEY` is empty, **when** `scripts/verify-openrouter-ci-secret.mjs` runs, **then** it exits non-zero. Coverage: smoke. Test: manual / GitHub Actions (`.github/workflows/ci.yml`).

### OpenRouter live (CI / local with key)
- **Given** `OPENROUTER_API_KEY` is set, **when** `resolveDedupEmbedOpenRouterModel` runs against the real OpenRouter embeddings catalog, **then** it returns a non-empty model id containing `/`. Coverage: integration. Test: `packages/dedup/tests/openrouter-dedup.live.test.ts::resolveDedupEmbedOpenRouterModel returns a catalog id`.
- **Given** `OPENROUTER_API_KEY` is set and `CLEARBOLT_DEDUP_LLM_MODEL` points at a working chat model, **when** `llmDedupSimilarityOpenRouter` runs on two synthetic listings, **then** it returns a finite `p_same` in `[0,1]`. Coverage: integration. Test: `packages/dedup/tests/openrouter-dedup.live.test.ts::llmDedupSimilarityOpenRouter returns p_same in [0,1]`.
- **Given** the same, **when** `scorePairAsync` runs, **then** `breakdown.llm` is a number in `[0,1]` and `overall` is in `[0,1]`. Coverage: integration. Test: `packages/dedup/tests/openrouter-dedup.live.test.ts::scorePairAsync includes numeric llm breakdown when key is set`.

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
