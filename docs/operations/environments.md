# Environments and deployment

Conventions to set early so they don't fight us later.

## Environments

- **dev**: local. Disk-backed storage. No Neon, no R2, no CF, no Fly. Single workspace. The V0 walking skeleton runs here.
- **preview**: per-PR. Separate Neon branch (Neon's branching feature), separate R2 bucket prefix (`preview-<pr-number>/`), separate CF Pages preview deployment, optional Fly app per PR (or shared preview Fly app).
- **staging**: shared. Pre-production validation. Real (small) Neon project, separate R2 bucket, separate CF deployment, separate Fly app.
- **prod**: production. Full Neon project, R2 bucket, CF deployment, Fly cluster.

Topology details in [../architecture/deployment.md](../architecture/deployment.md).

## Migrations

- Forward-only by default; reviewed in PR; runnable in dev/preview/staging without manual ceremony.
- Prisma v7 migration plan checked in; `prisma migrate deploy` on Fly entrypoint at boot for write API; idempotent.
- Neon branching used for preview migrations so PR migrations don't pollute prod.

## Secrets

- Vault-managed (Doppler / 1Password / SST); never plaintext-committed; loaded at runtime.
- Per-environment.
- Secrets that must exist on both sides (CF + Fly): better-auth secret, R2 keys, Neon connection strings (different drivers), AI provider keys.

## Feature flags

- Per-workspace and per-environment.
- Used to ship V2/V3 surfaces dark.
- Likely backend: a simple `FeatureFlag` table in `MetadataStore` initially; vendor (LaunchDarkly / Unleash) when scale demands.

## Background workers

- Deployable independently from the web app.
- Queue-backed (pg-boss on Neon).
- Workers on Fly machines; queue producers can run anywhere (CF Workers enqueue via Neon HTTP driver writing to pg-boss tables).

## Backups

- Nightly DB snapshots (Neon's automatic backups + point-in-time recovery).
- R2 versioning enabled on prod bucket.
- Restore tested at least quarterly.

## CI/CD

- Lint, typecheck, unit tests on every PR.
- After `pnpm install`, **`pnpm run verify:dependency-lag`** enforces the ~30-day npm release lag against `pnpm-lock.yaml` (see [dependency-lag.md](./dependency-lag.md)).
- Conformance suite for `EvidenceStore` / `MetadataStore` / `WikiStore` runs against in-memory + disk + (V1+) Neon test DB + R2 test bucket on every PR.
- Eval regression for AI tasks on every change to prompts / models / harness.
- Adapter canaries (sanitized real URLs) on every change to `packages/scraper/adapters/*`.
- Deploys: CF Pages + Workers via wrangler; Fly via `flyctl deploy` with rolling strategy; both behind GitHub Actions.

## Hosting decisions (`TODO`)

- CI provider: GitHub Actions assumed.
- Secrets manager: TBD (Doppler vs SST vs 1Password).
- Email infra: TBD (Postmark / SES / Mailgun).
- Observability: OpenTelemetry exporter target TBD (Honeycomb / Datadog / Tempo+Loki).

## Validation criteria

### Functional
- **Given** a fresh `dev` environment, **when** a developer follows the README, **then** the V0 walking skeleton runs end-to-end without any cloud accounts. Coverage: smoke. Test: `docs/onboarding-smoke.md` (manual checklist; verified at every contributor onboarding).
- **Given** a `preview` environment created for a PR, **when** the preview deploy completes, **then** it has a separate Neon branch, a separate R2 bucket prefix (`preview-<pr>/`), and a separate CF Pages preview URL. Coverage: integration. Test: `.github/workflows/preview-isolation.test.yml` (TBD V1).
- **Given** any migration in `prisma/migrations/`, **when** `prisma migrate deploy` runs at boot, **then** it is idempotent (re-running on an up-to-date DB is a no-op). Coverage: integration. Test: `services/api/tests/migrate-idempotent.test.ts` (TBD V1).

### CI gates
- **Given** any PR, **when** CI runs, **then** lint, typecheck, and unit tests pass (see `.github/workflows/ci.yml`). Coverage: smoke.
- **Given** any PR, **when** CI runs, **then** `pnpm run verify:dependency-lag` exits 0 for the committed `pnpm-lock.yaml` (registry publish times vs the lag window in `scripts/dependency-lag.config.json`). Coverage: smoke.
- **Given** any PR that touches `packages/storage*` or `packages/wiki-*`, **when** CI runs, **then** the conformance suite runs against in-memory + disk + (V1+) the test Neon branch + the test R2 bucket. Coverage: integration. Test: `.github/workflows/storage-conformance.yml` (TBD V1).
- **Given** any PR that touches `packages/scraper/adapters/*`, **when** CI runs, **then** the adapter canary fixtures (sanitized real URLs) run. Coverage: integration. Test: `.github/workflows/adapter-canary.yml` (TBD V1).
- **Given** any PR that touches AI prompts, models, or the harness, **when** CI runs, **then** the eval regression suite runs. Coverage: integration (V2+). Test: `.github/workflows/ai-eval.yml` (TBD V2).
- **Given** any PR, **when** CI runs, **then** `pnpm lint:specs` runs and (V0) reports failures advisorily, (V1+) blocks the PR. Coverage: smoke.

### Backups
- **Given** the V1+ production environment, **when** the quarterly restore drill runs, **then** a Neon point-in-time-restore + an R2 versioned-object restore both succeed end-to-end against a staging environment. Coverage: smoke. Test: documented runbook in `docs/operations/runbooks/restore-drill.md` (TBD V1.5).

### Workspace scoping
- **Given** any background worker deployed to Fly, **when** it reads from Neon, **then** the query plan includes a `workspaceId` filter unless the table is in the explicit shared-cache list. Coverage: integration. Test: `services/<each>/tests/workspace-scope-respected.test.ts` (TBD V1).
