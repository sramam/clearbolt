# Deduplication and Entity Resolution

Deduplication is a first-class product feature. Searchers should not waste time reviewing the same business listed in three places.

## Compositional `Scorer`

The dedup pipeline uses a **compositional `Scorer`**: a top-level score is the weighted sum of contributions from registered scorers. New scorers (vector in V1, LLM-judge in V1+) are added without rewriting existing ones.

```
score(pair) = sum_i  w_i * scorer_i(pair)
```

V0 contributors:

- `deterministic` — exact-match keys (URL, external ID, broker+listing ID, phone, email).
- `lexical` — token Jaccard on normalized title, first N chars of description.
- `numeric` — tolerance on asking price, revenue, cash flow, EBITDA.
- `geo` — agreement on state / MSA / city / postal.

V1+ contributors:

- `vector` — cosine similarity on description / fingerprint embeddings (pgvector on Neon per [../decisions/0011-vector-pgvector-on-neon-v1.md](../decisions/0011-vector-pgvector-on-neon-v1.md)).
- `llm-judge` (optional) — LLM explanation of uncertain pairs surfaced for human review.

Implementation in [`packages/dedup/agents.md`](../../packages/dedup/agents.md).

## V0 pipeline (programmatic only)

V0 must work without embeddings. LLM calls are **optional locally** (OpenRouter blend when `OPENROUTER_API_KEY` is set). **CI requires** `OPENROUTER_API_KEY` and runs live dedup integration tests. ADR: [../decisions/0002-dedup-v0.md](../decisions/0002-dedup-v0.md).

1. **Normalize** every source record into a stable shape:
   - URL: strip tracking/query params, normalize host case, drop trailing slashes.
   - Title: lowercase, strip punctuation, collapse whitespace, drop common boilerplate ("for sale", "business for sale", state suffixes).
   - Phone: digits only, country-coded (default +1).
   - Email: lowercase, trim.
   - Money: numeric, currency code (default USD).
   - Location: normalize to country + state + city + postal code where present.

2. **Compute deterministic keys** for the source record:
   - `urlKey = sha256(normalizedUrl)`
   - `externalKey = (adapter, externalListingId)` when adapter exposes one.
   - `brokerListingKey = (normalizedBrokerName | brokerDomain, externalListingId)` when present.
   - `phoneKey = normalizedPhone` when present.
   - `emailKey = normalizedEmail` when present.
   - `geoPriceKey = (state, cityOrMSA, priceBucket, cashFlowBucket)` as a coarse grouping.
   - `titleFingerprint = first 64 chars of normalized title hashed`.

3. **Lookup** existing canonical deals via the `DedupIndex`:
   - Strong match: any of `urlKey`, `externalKey`, `brokerListingKey`, `phoneKey`, `emailKey` equals an existing canonical deal -> attach as a new source on that deal.
   - Weak match: `geoPriceKey` + `titleFingerprint` agreement -> mark as a candidate, run lexical scoring.

4. **Lexical scoring** (no AI) for weak matches via `lexical` + `numeric` + `geo` scorers — implemented as `scorePair` in [`packages/dedup`](../../packages/dedup/agents.md).

4b. **Optional OpenRouter blend** — when `OPENROUTER_API_KEY` is set, `ingestSourceRecord` uses `scorePairAsync`, which calls OpenRouter chat completions. **`CLEARBOLT_DEDUP_LLM_MODEL`** pins a model; **when unset**, a **free** text model is chosen from the live [models API](https://openrouter.ai/api/v1/models) (cached), preferring Gemma / Nemotron / Qwen / DeepSeek / MiniMax / `gpt-oss` free slugs when available ([sorted UI](https://openrouter.ai/models?output_modalities=text&order=pricing-low-to-high)). If resolution fails, falls back to tiny paid Llama 3.2 1B. CI sets `OPENROUTER_API_KEY` from GitHub Actions secrets and pins a free chat model (see `.github/workflows/ci.yml`).

4c. **Body fingerprint + optional embeddings** — each scrape computes `bodyFingerprint` (sha256 of normalized visible HTML text) on the listing blob. Re-scrapes that merge onto the same canonical via URL/external keys set `contentUpdated` when the fingerprint differs from the **representative** source. Optional: OpenRouter **`POST /api/v1/embeddings`** (same API key) with `CLEARBOLT_DEDUP_EMBED=1`; **`CLEARBOLT_DEDUP_EMBED_MODEL`** pins a slug, and **when unset** the implementation calls the public **`GET /api/v1/embeddings/models`** list (no key), prefers free embedding models (`DEDUP_FREE_EMBED_MODEL_PREFERENCES`), then cheapest paid by `pricing.prompt`, else falls back to `openai/text-embedding-3-small`. Resolved model ids are cached (same TTL envs as the LLM catalog). Stores `bodyEmbedding` on the `SourceRecord` for pairwise cosine in `scorePair` / `scorePairAsync` when both sides share embedding dimension. V1 moves vectors to pgvector per [0011](../decisions/0011-vector-pgvector-on-neon-v1.md).

5. **Decision**:
   - Above auto-merge threshold: attach the source to the existing canonical deal; update last-seen and field-level provenance.
   - Below review threshold: create a new canonical deal; persist sub-threshold candidate pairs as `MergeCandidate` rows so V1's vector pass can re-evaluate without a full re-scan.
   - In between: write to a `dedup_review` queue (file in V0, table in V1).

## Listing fetch cooldown (scrape / catalog resume)

Before fetching listing HTML, scrape pipelines call `shouldSkipListingFetch` in `packages/dedup` so catalog resumes do not re-hit unchanged pages:

- Default **24h** minimum interval between detail fetches (`CLEARBOLT_LISTING_FETCH_COOLDOWN_HOURS` / `CLEARBOLT_LISTING_FETCH_MIN_INTERVAL_MS`; disable with `CLEARBOLT_LISTING_FETCH_COOLDOWN=0`).
- **`CLEARBOLT_LISTING_FETCH_SKIP_KNOWN=1`** — skip listings that already resolve to a canonical via dedup keys (fast resume).
- Per-listing status on disk/R2: `listing-ingest-state/<adapter>/<externalId>/state.json` (`ingested` \| `failed` \| `skipped_known` \| `skipped_fresh`) in `packages/scraper`.

Tests: `packages/dedup/tests/listing-fetch-cooldown.test.ts`.

## Multi-source preservation rule

ADR: [../decisions/0003-multi-source-preservation.md](../decisions/0003-multi-source-preservation.md).

- Source records are **never** discarded by dedup. Two observations of the same listing on two sites become two source records linked to one canonical deal.
- The canonical deal carries a `sources[]` array with `{ sourceRecordId, adapter, url, firstSeenAt, lastSeenAt }` and a per-field provenance map showing which source contributed each value.
- Conflicts (e.g. price differs across sources) are kept; merge policy decides which value to display, but original observations remain intact.

## Blocking keys

Use cheap candidate grouping before expensive similarity:

- Normalized source URL and canonical URL.
- External listing ID.
- Broker or firm plus listing ID.
- Phone/email plus geography.
- Price/revenue/cash-flow buckets.
- Location plus title fingerprint.

## V1 layer (vector + optional LLM judge)

V1 layers in:

- Vector candidates from embeddings on title / description / location / fingerprint stored in pgvector on Neon.
- Postgres FTS candidates for full-text search of source payloads.
- Optional LLM judge that explains uncertain pairs for human review.

The `Scorer`'s compositional shape means adding a `vector` contributor and re-weighting is a non-breaking change.

## Merge policy

Keep source records immutable where possible. Merge into canonical records with:

- Field-level provenance.
- Confidence scores per field.
- First-seen and last-seen timestamps per source.
- Conflict tracking for inconsistent facts.
- Human-review queue for uncertain merges.

AI can propose duplicate pairs and explain evidence. It does not silently merge high-impact records without thresholds or review.

`TODO:` Pin V0 weights, thresholds, and bucket sizes once the first adapter produces real data.

## Validation criteria

### Functional (V0)
- **Given** the known-pairs golden set, **when** the V0 dedup pipeline runs, **then** every `merge` pair scores ≥ 0.85, every `not-merge` pair scores ≤ 0.55, and every `borderline` pair lands in `[0.55, 0.85)`. Coverage: golden-set. Test: `packages/dedup/tests/known-pairs.test.ts` (V0).
- **Given** two `SourceRecord`s with the same `urlKey` (after normalization), **when** dedup runs, **then** they attach to the same `CanonicalDeal` deterministically (no scoring needed). Coverage: unit. Test: `packages/dedup/tests/url-key-deterministic.test.ts` (V0).
- **Given** two `SourceRecord`s with different `urlKey` but matching `(adapter, externalListingId)`, **when** dedup runs, **then** they attach via `externalKey` deterministically. Coverage: unit. Test: `packages/dedup/tests/external-id-deterministic.test.ts` (V0).
- **Given** two `SourceRecord`s with no deterministic-key match but matching title fingerprint and price/geo bucket, **when** the lexical scorer runs, **then** the score reflects token Jaccard + numeric tolerance + geo agreement and the decision routes per threshold. Coverage: integration. Test: `packages/dedup/tests/lexical-pipeline.test.ts` (V0).
- **Given** a sub-threshold candidate pair, **when** dedup completes, **then** a `MergeCandidate` row is persisted in `MetadataStore` so V1's vector pass can re-evaluate. Coverage: integration. Test: `packages/dedup/tests/sub-threshold-persists-candidate.test.ts` (V0).

### Functional (V1+)
- **Given** the V1 vector contributor added, **when** the same known-pairs golden set runs, **then** recall improves vs V0 baseline (more `borderline` pairs correctly classified) and precision does not regress below 95%. Coverage: golden-set. Test: `packages/dedup/tests/known-pairs.test.ts` (V1).
- **Given** the optional `llm-judge` contributor enabled for uncertain pairs, **when** the LLM returns a confidence below the auto-merge threshold, **then** the pair routes to the human-review queue with the LLM's explanation attached. Coverage: integration. Test: `packages/dedup/tests/llm-judge-routes-review.test.ts` (V1+).

### Compositional invariant
- **Given** the addition of a new contributor (vector, llm-judge, future signal), **when** the pipeline is reconfigured, **then** existing contributors remain unchanged and consumer code is untouched. Coverage: lint + integration. Test: `packages/dedup/tests/compositional-additivity.test.ts` (V1).

### Multi-source preservation
- **Given** two `SourceRecord`s that dedup correctly identifies as the same listing, **when** they attach to the same `CanonicalDeal`, **then** both `SourceRecord`s remain in `MetadataStore` (neither is deleted) and `CanonicalDeal.sources[]` length is 2. Coverage: integration. Test: `packages/dedup/tests/multi-source-preserved.test.ts` (V0).

### Failure modes
- **Given** a falsely-merged canonical deal, **when** an operator runs the split-canonical tool, **then** the selected `SourceRecord`s detach to a new `CanonicalDeal`, `fieldProvenance` is rebuilt for both, and history is preserved. Coverage: integration. Test: `packages/dedup/tests/split-canonical.test.ts` (V1).
- **Given** the `MergeCandidate` queue depth exceeds a configured threshold, **when** the operator dashboard renders, **then** a warning surfaces and the operator can trigger a human-review batch. Coverage: integration. Test: `apps/web/tests/dedup-review-queue-depth-alert.test.ts` (TBD V1).
