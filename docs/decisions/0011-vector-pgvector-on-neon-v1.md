# ADR 0011 — Vector storage: pgvector on Neon (V1+)

Status: accepted

## Context

V1 introduces a `vector` contributor to the dedup `Scorer` and a vector-backed retrieval layer for the wiki maintainer's `wiki-query` skill. Vector storage choices:

- **pgvector on Neon** — extension on the Postgres we already run; co-located with metadata; transactional; HNSW indexes; same connection.
- **Cloudflare Vectorize** — managed; CF-native; great at very high volume.
- **Dedicated vector DB** (Qdrant, Pinecone, Weaviate, LanceDB) — most performant at extreme scale; another system to operate.

At our V1 volume (50 workspaces, ~1M vectors total) costs are comparable. Ergonomics differ.

## Decision

**pgvector on Neon for V1+.**

Rationale:

- Co-located with metadata in the same DB. Joins and transactional consistency between vector hits and the rows they describe (canonical deals, wiki pages) are free.
- One connection, one driver, one backup story.
- HNSW indexes handle V1+V2 volume comfortably.
- Same DB on both runtimes (CF via Neon HTTP driver, Fly via node-postgres).
- Migration path: if scale demands later, `VectorStore` is a contract ([`packages/search/agents.md`](../../packages/search/agents.md)) so a swap to Vectorize / Qdrant / Pinecone is additive, not invasive.

Why not Vectorize:

- Better at very high volume (>10M vectors), but we're not there.
- Lives on a separate plane from metadata — joins require app-layer round-trips.
- Less ergonomic for the `LEFT JOIN canonical_deals d ON d.id = e.canonical_deal_id` patterns we'll write often.

Why not a dedicated vector DB:

- Operational overhead doesn't pay off at our V1 scale.
- Adding another database fights the "one source of truth for metadata" simplicity Neon gives us.

## Consequences

- pgvector extension enabled on the Neon DB.
- Embedding columns live on sibling tables (one per embedded entity type) so the main entity table stays narrow.
- HNSW indexes on each embedding column.
- The compositional `Scorer` ([`packages/dedup/agents.md`](../../packages/dedup/agents.md)) gains a `vector` contributor without rewriting prior contributors.
- Sub-threshold `MergeCandidate` rows persisted by V0 are re-evaluated by V1's vector pass — no full re-scan needed.
- If volume forces us to a dedicated vector DB later, the `VectorStore` contract makes it a backend swap.

## Falsifiability criteria

- **Trigger**: vector query p95 exceeds 500ms with HNSW indexes tuned (`m`, `ef_construction`, `ef_search` configured).
  **Measurement**: query latency telemetry on `dedup.vector.score` and `wiki.query.vector_search` spans.
  **Response**: switch to a dedicated vector DB via `VectorStore` swap (Vectorize, Qdrant, Pinecone).
- **Trigger**: Neon connection pool saturation due to vector queries (>80% pool utilization sustained).
  **Measurement**: Neon connection pool metrics.
  **Response**: separate read replica for vector queries OR swap `VectorStore` backend; same connection-pool problem could indicate we should split workloads earlier.
- **Trigger**: total vectors per workspace exceeds 100k routinely (per-workspace count averaged across the top decile).
  **Measurement**: per-workspace counts via `MetadataStore` query.
  **Response**: re-evaluate at 1M total across the platform; pgvector + HNSW handles low millions but we should plan the swap.
- **Trigger**: pgvector extension is deprecated by Neon or by Postgres community.
  **Measurement**: vendor announcements + extension health.
  **Response**: swap to dedicated vector DB.
- **Trigger**: any `VectorStore` consumer accesses pgvector-specific SQL (raw `<->` operator with no contract abstraction) outside `packages/storage-neon` or `packages/search`.
  **Measurement**: lint over `packages/*/src/**` for pgvector-specific syntax.
  **Response**: revisit; the abstraction is leaking and the swap will be harder than expected.
