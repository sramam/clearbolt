# Storage and Retrieval

Clearbolt separates evidence storage, structured metadata, lexical search, vector similarity, and per-deal wiki content. Each lives behind its own contract so the V0 disk implementation and the V1+ cloud implementation are interchangeable for consumers.

The contracts inventory lives in [contracts.md](contracts.md). This page describes how the pieces fit together.

## Two store interfaces, two backends

Two distinct backends, two distinct interfaces:

- **EvidenceStore** — blobs only. `put(rawPayload, meta) -> { key, sha256 }`, `get(key) -> stream`, `exists(sha256)`, `head(key)`.
  - V0: local disk (`data/raw/<adapter>/<sha256>.<ext>`).
  - V1+: **Cloudflare R2** (preferred) or any S3-compatible bucket via `packages/storage-r2`. Same interface, same content-addressed keys.
  - **Never** stored in Postgres. Postgres rows reference evidence by `(bucket, key, sha256, contentType, sizeBytes)` tuples.
- **MetadataStore** — structured records, indexes, workspace state. Plain typed CRUD, no blobs.
  - `SourceRecordStore`, `CanonicalDealStore`, `BrokerStore`, `WorkspaceStore`, `WikiPageIndexStore`, `DedupIndex`, `DealEventStore`, `AuditEventStore`.
  - V0: JSON/JSONL files on disk plus small index files (`data/sources/<id>.json`, `data/deals/<canonical_id>.json`, `data/index/<keyType>.json`).
  - V1+: **Neon (serverless Postgres) via Prisma v7** through `packages/storage-neon`. CF Workers use the Neon HTTP driver; Fly Node services use node-postgres.

## Object storage (R2 / S3-compatible)

Cloudflare R2 (preferred) or any S3-compatible bucket is the durable **evidence lake** behind `EvidenceStore`. Holds:

- Raw HTML/JSON/PDF/text payloads from the scraper.
- Screenshots where browser fallback is used.
- Imported CSVs and normalized row snapshots.
- Extracted text chunks and parser versions.
- LLM prompt/response artifacts where retention is allowed.
- Captured pages (raw HTML + converted Markdown) from the universal clipper.
- Raw audio + transcript markdown from the transcript pipeline.
- Per-workspace per-deal wiki markdown (via `WikiStore`'s `wiki-r2` backend).

Object storage is the source-of-truth for replayable evidence, not the primary query engine. Postgres rows reference these objects by `(bucket, key, sha256)`; payloads are never inlined into the database.

R2-specific notes:

- No egress fees makes it attractive for serving raw artifacts back to internal tools and replay jobs.
- Use lifecycle rules for derived/temporary artifacts (e.g. expired LLM caches) but never auto-delete primary source payloads without an explicit retention policy.
- Workspace-scoped prefix on every key for workspace-private data: `workspaces/<workspaceId>/<rest>`. Shared cache evidence (e.g. canonical deal raw payloads) lives under `shared/<adapter>/<sha256>.<ext>`.

## Relational database (Neon + Prisma v7)

Neon Postgres via Prisma v7 holds all structured state:

- Workspaces, users, memberships, saved searches, pipeline state.
- Source record metadata and object-storage pointers.
- Canonical deals/businesses, brokers, listings.
- `DealEvent` log per canonical deal.
- Contacts, outreach, buyer financial profiles.
- Fit scores, quality scores, provider leads, consent events.
- Workspace finds, search-run result membership, listing feedback, ranking profiles.
- Wiki page index (path, slug, last-modified, source-page count, embedding ref).
- pg-boss queue tables.
- pgvector embeddings (V1+).

Schema clearly separates shared-cache tables from workspace-owned tables by ownership and access policy. See [data-model.md](data-model.md) for the schema sketch.

## Wiki content (markdown)

`WikiStore` is its own contract because wiki content has different lifecycle and access patterns than evidence:

- Frequently rewritten by the wiki maintainer agent (vs. raw evidence which is immutable).
- Per-workspace per-deal directory structure (vs. content-addressed flat keys).
- Optionally versioned (V0: `git init`; V1+: content-addressed snapshots in R2 with version pointers in the index).

Backends:

- V0: `packages/wiki-fs` writes the directory tree under `workspaces/<id>/wiki/` on local disk.
- V1+: `packages/wiki-r2` writes markdown to R2; `MetadataStore` indexes pages for fast querying without scanning the bucket.

See [wiki.md](wiki.md) and [`packages/wiki/agents.md`](../../packages/wiki/agents.md).

## Lexical search

`SearchIndex` (BM25-style):

- V0: in-memory MiniSearch built on demand from `MetadataStore` rows. Sufficient for a single-machine walking skeleton.
- V1+: Postgres FTS on Neon. Indexes source payload text, titles, descriptions, locations, brokers. Generates lexical candidate sets for deduplication. Powers shared-cache listing retrieval before workspace-specific filters and ranking are applied.

Quickwit is a candidate for a future high-volume tier (operational logs and search history at scale) but Postgres FTS is the V1 default — one fewer system to operate.

## Vector embeddings

`VectorStore`:

- V0: none. Per [ADR 0011](../decisions/0011-vector-pgvector-on-neon-v1.md), V0's dedup is deterministic + lexical only. Sub-threshold pairs are persisted as `MergeCandidate`s for V1's vector pass to re-evaluate.
- V1+: pgvector on Neon. Same database as metadata, transactional consistency with the rest of the model, no second system to operate.
- Future: dedicated vector DB (Vectorize / Qdrant / Pinecone) only if scaling demands.

Good vector inputs:

- Normalized title.
- Short business description.
- Industry/category text.
- Location text.
- Broker/source notes.
- Generated compact "deal fingerprint" text derived only from source evidence.
- Wiki page text (for `wiki-query`).

## Personalization layer

Personalization is an overlay on top of shared retrieval — never written back into shared listing quality.

Flow:

1. Retrieve candidates from the shared cache using structured filters, lexical search, and (V1+) vector candidates.
2. Apply workspace constraints: saved search criteria, hidden/passed listings, geography, financial profile, market definition, and pipeline state.
3. Re-rank with workspace signals: likes, dislikes, saves, passes, advanced deals, and feedback reasons.
4. Return an explanation that distinguishes global facts from workspace-specific preference effects.

## Re-extraction and replay

Parsers, prompts, and dedup logic will change. The pipeline must re-derive canonical state from preserved evidence without re-scraping.

Principles:

- **Versioned parsers** and **versioned extraction prompts**; record the version on each derived field.
- **Replay jobs** can re-parse stored R2 payloads and rebuild canonical fields without hitting source sites.
- **Dedup re-runs** can re-evaluate candidate sets when blocking/scoring changes, with diff reports.
- **Backfill** safe to run incrementally and idempotently per adapter/version.

Operational:

- Track which canonical records are stale relative to current parser/prompt versions.
- Provide tooling to re-extract a single source, an adapter's history, or a date range.
- Make it cheap to roll back a bad parser version by re-running the prior version on the same payloads.

`TODO:` Define parser/prompt versioning policy, replay job triggers, and idempotency keys.

## Validation criteria

### Functional
- **Given** the disk `EvidenceStore` backend, **when** the conformance suite from `packages/storage/src/conformance/evidence-store.suite.ts` runs, **then** every assertion passes. Coverage: conformance. Test: `packages/storage/tests/disk-evidence-store.test.ts::conformance` (V0).
- **Given** the disk `MetadataStore` backend, **when** the conformance suite runs, **then** every assertion passes. Coverage: conformance. Test: `packages/storage/tests/disk-metadata-store.test.ts::conformance` (V0).
- **Given** the V1 R2 `EvidenceStore` backend, **when** the same conformance suite runs against R2, **then** every assertion passes (substitutability proof). Coverage: conformance. Test: `packages/storage-r2/tests/r2-evidence-store.test.ts::conformance` (TBD V1).
- **Given** the V1 Neon `MetadataStore` backend, **when** the same conformance suite runs against Neon, **then** every assertion passes. Coverage: conformance. Test: `packages/storage-neon/tests/neon-metadata-store.test.ts::conformance` (TBD V1).
- **Given** the disk `WikiStore` backend (wiki-fs), **when** the conformance suite runs, **then** every assertion passes. Coverage: conformance. Test: `packages/wiki-fs/tests/wiki-fs.test.ts::conformance` (TBD V1 dev).
- **Given** the R2 `WikiStore` backend (wiki-r2), **when** the same conformance suite runs against R2, **then** every assertion passes. Coverage: conformance. Test: `packages/wiki-r2/tests/wiki-r2.test.ts::conformance` (TBD V1 prod).

### Boundary
- **Given** any `EvidenceStore` operation, **when** invoked, **then** the call does not transit a `MetadataStore` (no joining at the storage layer). Coverage: lint. Test: `scripts/lint-specs.mjs::storage_boundary` (TBD V1).
- **Given** any `MetadataStore` write, **when** the row contains an evidence reference, **then** the reference is stored as `(bucket, key, sha256, contentType, sizeBytes)` and never as inline bytes. Coverage: type-level + lint. Test: `packages/storage/tests/no-blobs-in-metadata.test.ts` (TBD V1).

### Re-extraction / replay
- **Given** a populated `EvidenceStore` and a versioned parser bump, **when** the replay job runs against an adapter's history, **then** every existing `SourceRecord` produces a new `parsedFields` payload stamped with the new parser version, and a diff report is emitted. Coverage: integration. Test: `packages/storage/tests/replay-job.test.ts` (TBD V1).
- **Given** a re-extraction job with an invalid version, **when** it would write a non-improvement (per the dry-run diff), **then** the job aborts safely and the prior version remains the source of truth. Coverage: integration. Test: `packages/storage/tests/replay-rollback-safe.test.ts` (TBD V1).

### Workspace scoping
- **Given** any `EvidenceStore` write for workspace-private content, **when** the key is generated, **then** it begins with `workspaces/<workspaceId>/`. Coverage: unit. Test: `packages/storage/tests/key-prefix-workspace-scoped.test.ts` (V0).
- **Given** any `MetadataStore` query against a workspace-scoped table, **when** invoked without a `workspaceId`, **then** the call is rejected. Coverage: integration. Test: `packages/storage/tests/workspace-scope-required.test.ts` (V0 advisory; V1 enforced).

### Idempotency
- **Given** the same payload `put` twice via `EvidenceStore`, **when** measured, **then** the underlying storage holds the bytes exactly once (content-addressed dedup at the store layer). Coverage: conformance. Test: `packages/storage/src/conformance/evidence-store.suite.ts::put_is_content_addressed` (V0).
- **Given** the same logical record `upsert` twice via `MetadataStore`, **when** measured, **then** the row exists exactly once and `updatedAt` reflects the latest call. Coverage: conformance. Test: `packages/storage/src/conformance/metadata-store.suite.ts::upsert_is_idempotent` (V0).
