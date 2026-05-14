# `packages/search`

> Runtime: **both**. Backends differ by tier.

Lexical search (BM25-style) and vector search contracts.

## Contracts

```ts
interface SearchIndex {
  index(workspaceId: string | null, doc: SearchDoc): Promise<void>;     // null = shared cache
  query(workspaceId: string | null, q: string, opts?: QueryOpts): Promise<SearchHit[]>;
  delete(workspaceId: string | null, docId: string): Promise<void>;
}

interface VectorStore {
  upsert(workspaceId: string | null, ref: string, embedding: number[], meta?: Record<string, unknown>): Promise<void>;
  search(workspaceId: string | null, embedding: number[], opts?: VectorSearchOpts): Promise<VectorHit[]>;
  delete(workspaceId: string | null, ref: string): Promise<void>;
}
```

## Backends

### `SearchIndex` (BM25)

- V0: in-memory MiniSearch built on demand from `MetadataStore` rows. Sufficient for the walking skeleton.
- V1+: Postgres FTS on Neon. Indexes source payload text, titles, descriptions, locations, brokers, wiki page text. Generates lexical candidate sets for the dedup `Scorer`'s `lexical` contributor.
- Future: Quickwit if log-style scale demands it.

### `VectorStore`

- V0: not used. Per [ADR 0011](../../docs/decisions/0011-vector-pgvector-on-neon-v1.md).
- V1+: pgvector on Neon. Same DB as metadata, transactional, no second system.
- Future: dedicated vector DB (Vectorize / Qdrant / Pinecone) only if scaling demands.

## What gets embedded

- Canonical deal: title, description, location, industry, broker (one embedding per deal).
- Wiki pages: per page (for `wiki-query`).
- Brokers: name + firm + websites.
- Captured pages: full markdown.
- Transcripts: chunked markdown.

`Embedder` contract lives in [`packages/ai`](../ai/agents.md).

## Multi-tenancy

`workspaceId | null` on every method:

- `null` for shared-cache documents (canonical deals, brokers).
- workspace ID for workspace-private documents (wiki pages, captures, transcripts attached to that workspace).

V1+ enforces tenant isolation at the query layer — queries against `workspaceId = X` cannot return documents from `workspaceId = Y`.

## Validation criteria

### Conformance
- **Given** any `SearchIndex` backend, **when** the conformance suite at `packages/search/src/conformance/search-index.suite.ts` runs, **then** all assertions pass: index/query/delete round-trips, BM25-style ranking is monotonic in term-overlap, deletes are reflected in next query. Coverage: integration. Test: `packages/search/tests/search-index-conformance.test.ts` (TBD V1).
- **Given** any `VectorStore` backend, **when** the conformance suite at `packages/search/src/conformance/vector-store.suite.ts` runs, **then** all assertions pass: upsert/search/delete round-trips, cosine-distance returns are sorted, identical embeddings return distance 0. Coverage: integration. Test: `packages/search/tests/vector-store-conformance.test.ts` (TBD V1).

### Tenant isolation (hard rule)
- **Given** any `SearchIndex` query with `workspaceId=X`, **when** documents indexed under `workspaceId=Y` exist, **then** they do not appear in results. Coverage: integration. Test: `packages/search/tests/search-index-tenant-isolated.test.ts` (TBD V1). Part of the cross-tenant suite that must always be 100%.
- **Given** any `VectorStore` search with `workspaceId=X`, **when** vectors upserted under `workspaceId=Y` exist, **then** they do not appear in results. Coverage: integration. Test: `packages/search/tests/vector-store-tenant-isolated.test.ts` (TBD V1).
- **Given** any query with `workspaceId=null` (shared cache), **when** run, **then** workspace-private documents/vectors are not returned. Coverage: integration. Test: `packages/search/tests/shared-cache-no-private.test.ts` (TBD V1).

### Performance thresholds (V1+ pgvector / Postgres FTS)
- **Given** the `SearchIndex` (Postgres FTS) backend on a workspace with 100k canonical deals, **when** queried, **then** P95 latency ≤ 250ms. Coverage: smoke. Test: `packages/search/tests/fts-latency-budget.test.ts` (TBD V1.5).
- **Given** the `VectorStore` (pgvector) backend with 100k embeddings (dim=1536) under HNSW, **when** queried, **then** P95 latency ≤ 200ms. Coverage: smoke. Test: `packages/search/tests/pgvector-latency-budget.test.ts` (TBD V1.5). Triggers ADR 0011 falsifiability if breached.

### Embedding coverage
- **Given** any new canonical deal / wiki page / capture / transcript / broker, **when** stored, **then** an embedding job is enqueued and the corresponding `VectorStore` row exists within the configured indexing SLA (default 5 minutes). Coverage: integration. Test: `packages/search/tests/embedding-coverage-sla.test.ts` (TBD V1.5).

### Cross-link
- ADR: [`docs/decisions/0011-vector-pgvector-on-neon-v1.md`](../../docs/decisions/0011-vector-pgvector-on-neon-v1.md).
- Embedder contract: [`packages/ai`](../ai/agents.md).
