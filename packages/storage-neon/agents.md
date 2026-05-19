# `packages/storage-neon`

> Runtime: **node** today (Fly / local Next server actions). CF Workers HTTP driver binding is planned for V1 edge reads.

Neon Postgres + Prisma v7 backend for `MetadataStore` and shared deal search. Implements the V0 JSONB metadata contract from [`packages/storage`](../storage/agents.md).

## Driver

- **Fly Node / local dev:** `NeonMetadataStore` with `pg` + `@prisma/adapter-pg` via `getPrisma()` from [`packages/db`](../db/agents.md).
- **CF Workers:** `@neondatabase/serverless` HTTP driver (planned; not wired in apps yet).

`neonMetadataConfigFromEnv()` reads `DATABASE_URL` (and related) from the same env files as the CLI and web app.

## Schema in use today

All DDL lives in [`packages/db`](../db/agents.md). Tables this package reads/writes now:

| Table | Role |
|-------|------|
| `source_records`, `canonical_deals`, `dedup_mappings`, `domain_profiles` | V0 metadata JSONB (mirrors disk layout in payloads) |
| `deal_search_index` | Shared lexical index: `title`, `location`, `document`, `adapters`, `search_vector` (trigger-maintained) |
| `workspace_projects`, `user_project_dispositions`, `user_market_queries` | Team pipeline + per-user dealbox / saved searches (`owner_user_id` = `User.id`) |
| `user`, `session`, `organization`, `member`, `invitation`, … | better-auth (via [`packages/auth`](../auth/agents.md)) |

Broader entities in [data-model.md](../../docs/architecture/data-model.md) (brokers, wiki, captures, merge candidates, pgvector embeddings) are **not** in the current Prisma schema yet — add via `packages/db` migrations when those surfaces ship.

## Deal search (Postgres FTS)

[`deal-search-index.ts`](src/deal-search-index.ts):

- **`buildDealSearchDocument`** / **`upsertDealSearchIndex`** — rebuild row from canonical + sources after ingest.
- **`searchDealSearchIndex`** / **`searchDealSearchIndexOr`** — ranked hits for the web explorer (`apps/web/lib/deals.ts`).
- **`reindexAllDealSearch`** — backfill helper.

Migration: `20260519000000_deal_search_fts` (`pg_trgm` + GIN on `search_vector` and title/location). Query prep: [`packages/search`](../search/agents.md) `prepareSearchQuery`.

## Workspace pipeline

[`workspace-pipeline.ts`](src/workspace-pipeline.ts) — CRUD for projects and user dispositions (used by web actions; tenant columns enforced in SQL).

## Multi-tenancy

- Workspace-scoped rows use `workspace_id` (= better-auth org id).
- User-scoped rows use `owner_user_id` / `user_id` = internal **`User.id`**, never email ([`teams-projects-dealbox`](../../docs/architecture/teams-projects-dealbox.md)).
- Application-layer filtering in store methods; row-level security is not enabled on Neon yet.

## Migrations

Schema and SQL live in [`packages/db`](../db/agents.md) only. Never add `prisma/` here.

- Apply: root `pnpm db:migrate`
- Author: root `pnpm db:migrate:dev -- --name …`

## Conformance

When `DATABASE_URL` is set, `packages/storage-neon/tests/conformance.test.ts` runs `assertMetadataStoreConformance` from `packages/storage`. Skips in CI without credentials.

## pgvector / pg-boss (planned V1+)

- Embeddings: [ADR 0011](../../docs/decisions/0011-vector-pgvector-on-neon-v1.md) — sibling tables + HNSW (not in schema yet).
- Queue: pg-boss tables in the same Neon DB per [`packages/queue`](../queue/agents.md) (not migrated yet).

## Validation criteria

### Conformance
- **Given** the `NeonMetadataStore` backend and `DATABASE_URL` configured, **when** `assertMetadataStoreConformance` from `packages/storage/src/conformance/metadata.suite.ts` runs, **then** all sub-store assertions pass. Coverage: integration. Test: `packages/storage-neon/tests/conformance.test.ts`.

### User-scoped owner keys
- **Given** `UserMarketQuery` or `UserProjectDisposition` rows, **when** created via the store, **then** owner columns store internal `userId` only, not email. Coverage: integration. Test: `packages/storage-neon/tests/user-scoped-owner-is-user-id.test.ts`.

### Deal search index
- **Given** a canonical deal upserted in metadata, **when** `upsertDealSearchIndex` runs, **then** `deal_search_index` contains a row with non-null `search_vector` after commit. Coverage: integration. Test: TBD (add with FTS regression suite).

### Tenant isolation (hard rule; planned V1)
- **Given** any workspace-scoped sub-store call, **when** invoked, **then** the SQL query plan includes the `workspaceId` predicate (verified via `EXPLAIN`). Coverage: integration. Test: `packages/storage-neon/tests/workspace-predicate-required.test.ts` (planned V1).
- **Given** workspace A's row, **when** workspace B (or no workspace context) reads, **then** the read returns nothing. Coverage: integration. Test: `packages/storage-neon/tests/cross-tenant-no-leak.test.ts` (planned V1).

### Driver split
- **Given** a CF Worker context, **when** `NeonMetadataStore` is bound, **then** `@neondatabase/serverless` HTTP driver is used. Coverage: integration. Test: `packages/storage-neon/tests/driver-cf-workers.test.ts` (planned V1).
- **Given** a Fly Node context, **when** `NeonMetadataStore` is bound, **then** the standard `pg` driver is used. Coverage: integration. Test: `packages/storage-neon/tests/driver-fly-node.test.ts` (planned V1).

### Migrations
- **Given** the `20260518000000_init` migration, **when** `prisma migrate deploy` runs on an empty database, **then** metadata, pipeline, and better-auth tables exist with expected FKs (e.g. `user_project_dispositions.project_id` → `workspace_projects.id` ON DELETE CASCADE). Coverage: integration. Test: `packages/db/tests/migrate-idempotent.test.ts`.
- **Given** `20260519000000_deal_search_fts`, **when** deploy runs, **then** `deal_search_index` and `pg_trgm` extension exist. Coverage: integration. Test: `packages/db/tests/migrate-idempotent.test.ts`.
- **Given** any migration in `packages/db/prisma/migrations/`, **when** `prisma migrate deploy` runs at boot, **then** it is idempotent (re-run on up-to-date DB is a no-op). Coverage: integration. Test: `packages/db/tests/migrate-idempotent.test.ts`.

### Cross-link
- ADR: [`docs/decisions/0011-vector-pgvector-on-neon-v1.md`](../../docs/decisions/0011-vector-pgvector-on-neon-v1.md), [`docs/decisions/0012-multi-tenancy-workspace-as-tenant.md`](../../docs/decisions/0012-multi-tenancy-workspace-as-tenant.md).
- Teams / projects / queries: [`docs/architecture/teams-projects-dealbox.md`](../../docs/architecture/teams-projects-dealbox.md).
- Web consumer: [`apps/web/agents.md`](../../apps/web/agents.md).
