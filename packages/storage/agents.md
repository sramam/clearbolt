# `packages/storage`

> Runtime: **both** (node + workers). Contracts here. Backends as siblings.

Defines the storage contracts and ships disk-backed defaults baked in for V0. Heavier backends live as sibling packages: [`packages/storage-r2`](../storage-r2/agents.md), [`packages/storage-neon`](../storage-neon/agents.md), [`packages/wiki-fs`](../wiki-fs/agents.md), [`packages/wiki-r2`](../wiki-r2/agents.md).

ADR: [`docs/decisions/0001-storage-split.md`](../../docs/decisions/0001-storage-split.md).

## Three contracts

### `EvidenceStore` — raw blobs

```ts
interface EvidenceStore {
  put(payload: Uint8Array | NodeJS.ReadableStream, meta: PutMeta): Promise<EvidenceRef>;
  get(ref: EvidenceRef): Promise<NodeJS.ReadableStream>;
  exists(sha256: string): Promise<boolean>;
  head(ref: EvidenceRef): Promise<EvidenceMeta>;
}

interface EvidenceRef {
  bucket: string;
  key: string;
  sha256: string;
  contentType: string;
  sizeBytes: number;
}
```

V0: disk under `data/raw/<adapter>/<sha256>.<ext>`. V1+: R2 via [`packages/storage-r2`](../storage-r2/agents.md).

Content-addressed: same payload via different URLs (tracking params) is stored once.

### `MetadataStore` — structured records and indexes

A namespace of typed CRUD APIs:

```ts
interface MetadataStore {
  workspaces: WorkspaceStore;
  sources: SourceRecordStore;
  canonicals: CanonicalDealStore;
  brokers: BrokerStore;
  dealEvents: DealEventStore;
  captures: WorkspaceCaptureStore;
  feedback: WorkspaceFeedbackStore;
  finds: WorkspaceFindStore;
  savedSearches: WorkspaceSavedSearchStore;
  wikiPages: WikiPageIndexStore;
  audit: AuditEventStore;
  dedupIndex: DedupIndex;
  domainProfiles: DomainProfileStore;        // needsBrowser, AIMD persisted state
  // ... etc
}
```

Each sub-store is its own interface so backends can implement piecewise (e.g. for tests).

V0: JSON/JSONL files under `data/`. V1+: Neon Postgres + Prisma v7 via [`packages/storage-neon`](../storage-neon/agents.md).

### `WikiStore` — markdown pages

```ts
interface WikiStore {
  read(workspaceId: string, path: string): Promise<{ content: string; sha256: string } | null>;
  write(workspaceId: string, path: string, content: string, opts?: WriteOpts): Promise<{ sha256: string }>;
  list(workspaceId: string, prefix?: string): AsyncIterable<{ path: string; lastModified: Date }>;
  snapshot?(workspaceId: string, path: string, sha256: string): Promise<void>;
}
```

V0: [`packages/wiki-fs`](../wiki-fs/agents.md) — disk under `workspaces/<id>/wiki/`, optional `git init`. V1+: [`packages/wiki-r2`](../wiki-r2/agents.md) — R2 with content-addressed snapshots.

## Rules

- The scraper, normalizer, dedup, capture pipeline, wiki maintainer, and any consumer depend on the **interfaces**, not the implementations.
- Every write is **idempotent on a stable key** (see `packages/dedup` for keyer logic) so re-runs do not duplicate work.
- All backends are tested against the same conformance suite (disk vs R2 for `EvidenceStore`; disk vs Neon for `MetadataStore`).
- Raw payloads are content-addressed (sha256) so the same observation is never stored twice even if URLs differ.
- Source records carry a small `EvidenceRef` to the payload; they do not embed the payload.

### Tenant and identity keys

- **Team tenant** = **`workspaceId`** (better-auth org / Clearbolt workspace). Team-scoped Neon rows and R2 blobs live under this boundary.
- **R2:** workspace-scoped keys use prefix `workspaces/<workspaceId>/…`. User-private or per-member artifacts (e.g. dataroom uploads, personal notes) stay under the same workspace prefix with an additional segment such as `users/<userId>/…` so isolation stays testable; never key by email.
- **Neon:** workspace-scoped tables include `workspace_id`. Per-user ownership (`UserMarketQuery.owner_user_id`, `UserProjectDisposition.user_id`, etc.) uses better-auth **`User.id`** — stable internal id, **not** email ([`docs/architecture/teams-projects-dealbox.md`](../../docs/architecture/teams-projects-dealbox.md), [`packages/auth`](../auth/agents.md)).
- **Shared canonical cache** (listings, dedup) may omit `workspace_id` by design; see ADR [0003](../../docs/decisions/0003-multi-source-preservation.md).

## Conformance test suite

Run the same suite against any combination of backends:

- Round-trip a payload through `EvidenceStore.put` -> `head` -> `get` -> verify sha256.
- `exists(sha256)` true after put, false before.
- Idempotent put with the same sha256.
- `MetadataStore.upsert` with the same dedup key returns the same row.
- `WikiStore.write` -> `read` -> exact match.
- Cross-tenant isolation: a write under workspace A is not readable under workspace B.

## V0 default backends (baked into this package)

- `DiskEvidenceStore` — `data/raw/<adapter>/<sha256>.<ext>`.
- `DiskMetadataStore` — JSON/JSONL files under `data/{sources,deals,brokers,...}/`, simple per-key index files.
- `WikiStore` defaulted via `packages/wiki-fs` when wired by the consumer.

## Bindings (later)

A small `bindStorage()` factory in this package selects backends from env / config:

```ts
const storage = await bindStorage({
  evidence: { kind: 'disk', root: 'data/raw' },        // or { kind: 'r2', bucket, ... }
  metadata: { kind: 'disk', root: 'data' },            // or { kind: 'neon', databaseUrl }
  wiki:     { kind: 'disk', root: 'workspaces' },      // or { kind: 'r2', bucket, indexStore }
});
```

## Validation criteria

### Conformance (every backend must pass)
- **Given** any `EvidenceStore` backend, **when** the suite at `packages/storage/src/conformance/evidence.suite.ts` runs, **then** all assertions pass: round-trip put/head/get with sha256 verification, `exists` true after put, idempotent put, and content-addressed deduplication. Coverage: integration. Test runs against `DiskEvidenceStore` (V0) and `R2EvidenceStore` (V1). TBD V0.
- **Given** any `MetadataStore` sub-store, **when** the suite at `packages/storage/src/conformance/metadata.suite.ts` runs, **then** all assertions pass: typed CRUD, idempotent upsert on stable key, list/cursor semantics, transactional consistency. Coverage: integration. Test runs against `DiskMetadataStore` (V0) and `NeonMetadataStore` (V1). TBD V0.
- **Given** any `WikiStore` backend, **when** the suite at `packages/storage/src/conformance/wiki.suite.ts` runs, **then** all assertions pass: write/read exact match, listing prefix, optional snapshot. Coverage: integration. Test runs against `WikiFsStore`; `WikiR2Store` (V1). V0: `packages/wiki-fs/tests/conformance.test.ts`.

### Tenant isolation (hard rule)
- **Given** any backend, **when** workspace A writes a row/blob/page and workspace B reads with the same logical key, **then** the read returns nothing (or 403). Coverage: integration. Test: `packages/storage/src/conformance/tenant-isolation.suite.ts` (TBD V1).
- **Given** any R2-backed implementation, **when** any workspace-scoped key is generated, **then** it carries the `workspaces/<workspaceId>/` prefix. Coverage: integration. Test: `packages/storage-r2/tests/key-prefix.test.ts` (TBD V1).
- **Given** any Neon-backed implementation, **when** any workspace-scoped query runs, **then** the query plan includes the `workspaceId` predicate. Coverage: integration. Test: `packages/storage-neon/tests/workspace-predicate.test.ts` (TBD V1).
- **Given** a per-user row (e.g. market query, disposition), **when** persisted, **then** the owner key is internal `userId` (`User.id`), never email. Coverage: integration. Test: `packages/storage-neon/tests/user-scoped-owner-is-user-id.test.ts`.

### Idempotency
- **Given** any consumer that writes the same `RawSourceRecord` twice (same dedup key), **when** writes complete, **then** exactly one row exists. Coverage: integration. Test: `packages/storage/tests/upsert-idempotent.test.ts` (TBD V0).

### Cross-link
- ADR: [`docs/decisions/0001-storage-split.md`](../../docs/decisions/0001-storage-split.md) — storage split rationale.
- Provenance: [`docs/architecture/data-model.md`](../../docs/architecture/data-model.md) — every record carries `EvidenceRef`.
- Teams, projects, queries: [`docs/architecture/teams-projects-dealbox.md`](../../docs/architecture/teams-projects-dealbox.md). Auth claims: [`packages/auth`](../auth/agents.md).
