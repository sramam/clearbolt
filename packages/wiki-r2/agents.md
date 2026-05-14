# `packages/wiki-r2`

> Runtime: **both**. R2-backed `WikiStore` for V1+ production.

Implements [`packages/storage`](../storage/agents.md)'s `WikiStore` contract against Cloudflare R2 with content-addressed snapshots and an index in `MetadataStore`.

## Layout (R2 keys)

```
workspaces/<workspaceId>/wiki/<path>                 # current page (mutable pointer-by-content)
workspaces/<workspaceId>/wiki-snapshots/<sha256>     # immutable content-addressed snapshot
```

Every `write()`:

1. Compute sha256 of new content.
2. If `wiki-snapshots/<sha256>` doesn't exist, write it (immutable).
3. Update the current page key to point at the new snapshot (atomic R2 put).
4. Update the `WikiPage` index row in `MetadataStore` (path, slug, last-modified, content-sha256, source-page count, embedding ref).

This gives us full version history without a separate VCS — every edit is preserved as a content-addressed snapshot, and the current pointer can be rolled back to any prior sha256.

## Index in MetadataStore

`WikiPage` rows in Neon (see [`docs/architecture/data-model.md`](../../docs/architecture/data-model.md)) carry the searchable index — path, slug, category, target ID, last-modified, embedding ref. This avoids scanning R2 for queries.

## Embeddings

Per [`docs/decisions/0011-vector-pgvector-on-neon-v1.md`](../../docs/decisions/0011-vector-pgvector-on-neon-v1.md), wiki page embeddings live in pgvector on Neon, referenced by the `WikiPage` index row.

## Conformance

Implements the full `WikiStore` conformance suite from `packages/storage`. CI runs against a real R2 bucket + Neon test branch.

## Validation criteria

### Conformance
- **Given** the `WikiR2Store` backend, **when** the `WikiStore` conformance suite from `packages/storage/src/conformance/wiki.suite.ts` runs against a real R2 bucket + Neon test branch, **then** all assertions pass. Coverage: integration. Test: `packages/wiki-r2/tests/conformance.test.ts` (TBD V1).

### Snapshots
- **Given** any `write()` call, **when** complete, **then** an immutable `wiki-snapshots/<sha256>` object exists, the current page key points to it, and the `WikiPage` index row is updated atomically with the same sha256. Coverage: integration. Test: `packages/wiki-r2/tests/snapshot-and-pointer-atomic.test.ts` (TBD V1).
- **Given** a `write()` of identical content (same sha256), **when** complete, **then** the snapshot is not re-uploaded (R2 short-circuit) and the index row updates only `lastModifiedAt`. Coverage: integration. Test: `packages/wiki-r2/tests/identical-write-deduped.test.ts` (TBD V1).
- **Given** any prior snapshot sha256, **when** a `restore(sha256)` is invoked, **then** the current pointer rolls back to that snapshot atomically. Coverage: integration. Test: `packages/wiki-r2/tests/rollback-to-snapshot.test.ts` (TBD V1).

### Index consistency (hard rule)
- **Given** any successful `write()`, **when** the index update fails, **then** the pointer update is rolled back (no `WikiPage` row out of sync with R2). Coverage: integration. Test: `packages/wiki-r2/tests/index-pointer-consistency.test.ts` (TBD V1).
- **Given** any read query, **when** answered via the `WikiPage` index in `MetadataStore`, **then** R2 is not scanned. Coverage: integration. Test: `packages/wiki-r2/tests/no-r2-scan-on-query.test.ts` (TBD V1).

### Tenant isolation
- Inherits cross-tenant isolation from `packages/storage/src/conformance/tenant-isolation.suite.ts` and the R2 key-prefix lint from `packages/storage-r2`.

### Embeddings
- **Given** a wiki page write, **when** complete, **then** an embedding job is enqueued and (eventually) the `WikiPage.embeddingRef` points to a pgvector row. Coverage: integration. Test: `packages/wiki-r2/tests/embedding-eventually-indexed.test.ts` (TBD V1.5).

### Cross-link
- ADR: [`docs/decisions/0011-vector-pgvector-on-neon-v1.md`](../../docs/decisions/0011-vector-pgvector-on-neon-v1.md).
