# `packages/db`

> **Single owner** of Postgres schema, Prisma Migrate, and the shared `PrismaClient`. Nothing else in the monorepo runs DDL or maintains parallel schema files.

## Owns

- `prisma/schema.prisma` — all tables (metadata JSONB rows, workspace pipeline, better-auth `user` / `organization` / …).
- `prisma/migrations/` — versioned SQL produced by **`prisma migrate dev`**, applied by **`prisma migrate deploy`**.
- `getPrisma` / `disconnectPrisma` — one pool per process for auth + stores.
- `databaseUrlFromEnv()` — `DATABASE_URL` normalization (Neon `uselibpqcompat`).

## Does not own

- **Query semantics** — `packages/storage-neon` implements `MetadataStore` / `WorkspacePipelineStore` using this client.
- **Auth policy** — `packages/auth` configures better-auth against the same Prisma client.

## Baseline migrations

| Migration | Purpose |
|-----------|---------|
| `20260518000000_init` | Metadata JSONB (`source_records`, `canonical_deals`, `dedup_mappings`, `domain_profiles`), team pipeline (`workspace_projects`, `user_project_dispositions`, `user_market_queries`), better-auth tables (`user`, `session`, `organization`, …). |
| `20260519000000_deal_search_fts` | `deal_search_index` with Postgres `tsvector` + `pg_trgm` indexes and maintain trigger. |

### Planned migrations (not yet applied)

Broker graph tables for marketplace broker enrichment (Part A) and broker-direct ingestion (Part B) per [data-model.md](../../docs/architecture/data-model.md#brokers) and [ADR 0016](../../docs/decisions/0016-broker-direct-ingestion-lane.md). **No SQL in repo until a feature PR** — schema changes only via `pnpm db:migrate:dev` after `schema.prisma` edit.

| Model | Purpose |
|-------|---------|
| `Broker` | Shared cache entity: `id`, `normalizedName`, `displayName`, `firmId?`, `websiteDomain?`, `primaryContactEmail?`, `primaryContactPhone?`, `lastObservedAt`, `sources` (jsonb), `enrichmentStatus` (`pending` \| `enriched` \| `no-website` \| `error`), `fieldProvenance` (jsonb) |
| `BrokerFirm` | Shared firm: `id`, `normalizedName`, `websiteDomain?`, `address?`, … |
| `BrokerListing` | Association: `brokerId`, `canonicalDealId`, `sourceRecordIds` (jsonb array or join table — finalize in migration PR) |

**Tenant boundary:** `Broker`, `BrokerFirm`, and `BrokerListing` are **shared** (no `workspaceId`). Same rule as `CanonicalDeal` — readable from any workspace wiki; writes only via ingestion pipelines. See [data-model.md validation criteria](../../docs/architecture/data-model.md#boundary).

**Indexes (target):** unique on `Broker.websiteDomain` where not null; index on `Broker.normalizedName`; FK `Broker.firmId` → `BrokerFirm`; unique `(brokerId, canonicalDealId)` on `BrokerListing`.

**Dev-only** reset after pulling a squashed baseline: **`pnpm db:reset-dev -- --confirm`** (`prisma migrate reset --force`).

## Workflow (only way to change the database)

1. Edit `prisma/schema.prisma` (or run `pnpm --filter @clearbolt/auth auth:schema` to merge better-auth models into the schema, then review the diff).
2. **`pnpm db:migrate:dev -- --name describe_change`** — creates a new migration folder under `prisma/migrations/`.
3. Commit schema + migration SQL together.
4. **`pnpm db:migrate`** — applies pending migrations (local, CI, Fly boot, `cloud:setup`).

Do **not** use `prisma db push` on shared envs, `better-auth migrate`, or hand-written SQL outside a `prisma migrate dev` commit.

## Scripts

| Command | Purpose |
|---------|---------|
| Root `pnpm db:migrate` | `prisma migrate deploy` |
| Root `pnpm db:migrate:dev` | `prisma migrate dev` (pass `--name`) |
| Root `pnpm db:reset-dev -- --confirm` | Drop `public` schema + `migrate deploy` (dev only) |
| `pnpm --filter @clearbolt/db build` | `prisma generate` + compile |

## Validation criteria

### Broker tables (when migration lands)
- **Given** the `Broker` / `BrokerFirm` / `BrokerListing` migration applied, **when** `schema-vs-data-model` runs, **then** Prisma models match [data-model.md](../../docs/architecture/data-model.md#brokers) field names and shared-layer boundary (no `workspaceId` on broker tables). Coverage: integration. Test: `packages/storage-neon/tests/schema-vs-data-model.test.ts::broker_models` (TBD V1).
- **Given** any insert into `BrokerListing`, **when** FK constraints are enforced, **then** invalid `brokerId` or `canonicalDealId` is rejected. Coverage: integration. Test: `packages/db/tests/broker-listing-fk.test.ts` (TBD V1).

- **Given** any change to persisted tables, **when** merged, **then** it appears only via `packages/db/prisma/schema.prisma` plus a new folder under `prisma/migrations/`. Coverage: PR review.
- **Given** `DATABASE_URL` set, **when** `pnpm db:migrate` runs twice, **then** the second run is a no-op. Coverage: integration. Test: `packages/db/tests/migrate-idempotent.test.ts`.
- **Given** a Neon URL with `sslmode=require`, **when** `normalizePgDatabaseUrl` runs, **then** `uselibpqcompat=true` is appended. Coverage: unit. Test: `packages/db/tests/normalize-pg-url.test.ts`.
