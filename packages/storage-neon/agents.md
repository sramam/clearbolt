# `packages/storage-neon`

> Runtime: **both**. Neon Postgres + Prisma v7 backend for `MetadataStore`. V1+ only.

Implements every sub-store of [`packages/storage`](../storage/agents.md)'s `MetadataStore` contract against Neon Postgres via Prisma v7.

## Driver split

- **CF Workers**: `@neondatabase/serverless` HTTP driver. Edge-compatible, no socket overhead.
- **Fly Node**: standard `pg` / `pg-pool` via Prisma's default driver.

The `bindStorage` selector in `packages/storage` picks the right driver based on runtime env.

## Schema

`packages/storage-neon/prisma/schema.prisma` carries the full schema. Sketch in [`docs/architecture/data-model.md`](../../docs/architecture/data-model.md).

Highlights:

- `Workspace`, `Membership`, `User` (last via better-auth's tables; we reference, not own).
- `SourceRecord`, `CanonicalDeal`, `Broker`, `BrokerFirm`, `BrokerListing`.
- `DealEvent` (append-only).
- `WorkspaceSavedSearch`, `WorkspaceSearchRun`, `WorkspaceFind`, `WorkspaceFeedback`, `WorkspaceRankingProfile`.
- `WorkspaceCapture`, `WikiPage`.
- `BuyerFinancialProfile`, `AcquisitionCriteria`, `FinancingScenario`, `DealFitScore`.
- `MarketDefinition`, `DealQualityScore`, `DiligenceGap`.
- `Contact`, `ContactMethod`, `OutreachAttempt`, `OutreachThread`, `NextAction`.
- `AuditEvent`.
- `MergeCandidate` (for V1 vector pass to re-evaluate sub-threshold V0 candidates).
- `DomainProfile` (`needsBrowser` + AIMD persisted state).
- `CanonicalDealEmbedding` (pgvector column; HNSW index).

## pgvector

ADR: [`docs/decisions/0011-vector-pgvector-on-neon-v1.md`](../../docs/decisions/0011-vector-pgvector-on-neon-v1.md).

- `vector` extension enabled on the database.
- Embedding columns live on sibling tables (one per embedded entity type) so the main entity table stays narrow.
- HNSW indexes on each embedding column.
- Cosine distance as the default operator.

## pg-boss

The queue contract ([`packages/queue`](../queue/agents.md)) backs by pg-boss tables in this same Neon database. Single source of truth, single backup story.

## Multi-tenancy

- Every workspace-scoped table has a `workspaceId String` column with FK to `Workspace.id`.
- Composite indexes that include `workspaceId` first to prevent accidental table scans across tenants.
- Row-level enforcement is at the application layer (`MetadataStore` sub-stores require an explicit workspace context for any workspace-scoped op).
- Cross-tenant tests in CI ensure no sub-store leaks across workspaces.

## Migrations

- Forward-only.
- `prisma migrate deploy` on Fly entrypoint at boot for write API.
- Neon branching for preview environments so PR migrations don't pollute prod.

## Conformance

Implements the full `MetadataStore` conformance suite from `packages/storage`. CI runs the suite against a real Neon test branch on every PR that touches this package.

## Validation criteria

### Conformance
- **Given** the `NeonMetadataStore` backend, **when** the `MetadataStore` conformance suite from `packages/storage/src/conformance/metadata.suite.ts` runs against a real Neon test branch, **then** all sub-store assertions pass. Coverage: integration. Test: `packages/storage-neon/tests/conformance.test.ts` (TBD V1).

### Tenant isolation (hard rule)
- **Given** any workspace-scoped sub-store call, **when** invoked, **then** the SQL query plan includes the `workspaceId` predicate (verified via `EXPLAIN`). Coverage: integration. Test: `packages/storage-neon/tests/workspace-predicate-required.test.ts` (TBD V1).
- **Given** workspace A's row, **when** workspace B (or no workspace context) reads, **then** the read returns nothing. Coverage: integration. Test: `packages/storage-neon/tests/cross-tenant-no-leak.test.ts` (TBD V1). Part of the cross-tenant suite that must always be 100%.
- **Given** any new sub-store added in the future, **when** registered, **then** it must declare its tables as workspace-scoped or shared explicitly; the lint refuses an "unspecified" default. Coverage: lint. Test: `scripts/lint-specs.mjs::substore_declares_scope` (TBD V1).

### Driver split
- **Given** a CF Worker context, **when** `NeonMetadataStore` is bound, **then** `@neondatabase/serverless` HTTP driver is used. Coverage: integration. Test: `packages/storage-neon/tests/driver-cf-workers.test.ts` (TBD V1).
- **Given** a Fly Node context, **when** `NeonMetadataStore` is bound, **then** the standard `pg` driver is used. Coverage: integration. Test: `packages/storage-neon/tests/driver-fly-node.test.ts` (TBD V1).

### pgvector (V1+)
- **Given** the `vector` extension enabled, **when** an HNSW index is queried with a cosine distance operator, **then** results are returned within the operational latency budget (P95 ≤ 200ms for 100k vectors, dimensions=1536). Coverage: smoke. Test: `packages/storage-neon/tests/pgvector-latency.test.ts` (TBD V1.5). Triggers ADR 0011 falsifiability if breached.
- **Given** any embedding column, **when** added in a migration, **then** it lives on a sibling table (the main entity table stays narrow). Coverage: lint. Test: `scripts/lint-specs.mjs::embedding_column_on_sibling_table` (TBD V1).

### Migrations
- **Given** any migration in `packages/storage-neon/prisma/migrations/`, **when** `prisma migrate deploy` runs at boot, **then** it is idempotent (re-run on up-to-date DB is a no-op). Coverage: integration. Test: `packages/storage-neon/tests/migrate-idempotent.test.ts` (TBD V1).
- **Given** any PR that touches `prisma/schema.prisma`, **when** CI runs, **then** the migration is applied to a Neon branch and the conformance suite passes against it. Coverage: integration. Test: `.github/workflows/storage-neon-migration.yml` (TBD V1).

### pg-boss co-tenancy
- **Given** pg-boss tables in this same Neon database, **when** queue ops run, **then** they do not block or contend pathologically with `MetadataStore` ops (queue and metadata isolated by schema or table). Coverage: smoke. Test: `packages/storage-neon/tests/pg-boss-noncontending.test.ts` (TBD V1.5).

### Cross-link
- ADR: [`docs/decisions/0011-vector-pgvector-on-neon-v1.md`](../../docs/decisions/0011-vector-pgvector-on-neon-v1.md), [`docs/decisions/0012-multi-tenancy-workspace-as-tenant.md`](../../docs/decisions/0012-multi-tenancy-workspace-as-tenant.md).
