# Cloud bootstrap (Neon + R2 + Resend) via CLI

V1+ resources are created with **`neonctl`**, **`wrangler`**, and the **Resend HTTP API**, wrapped by a repo script so dev / staging / prod stay consistent.

## Prerequisites

- `pnpm install` at repo root (installs `neonctl` and `wrangler` as devDependencies).
- **Neon:** `pnpm exec neonctl auth` (or `NEON_API_KEY`).
- **Cloudflare:** `pnpm exec wrangler login`.
- **R2:** set **`CLOUDFLARE_ACCOUNT_ID`** when Wrangler cannot pick an account (see `pnpm exec wrangler whoami`). Put bootstrap vars in **`.env.cloud.local`**, **`.env.dev`**, or **`.env`** at the repo root (all gitignored via `.env.*` except committed [`.env.example`](../../.env.example)); `pnpm cloud:provision` loads those files in that order using **dotenv** (existing shell env wins; later files do not override earlier).
- **Resend:** one-time **`RESEND_BOOTSTRAP_API_KEY`** (full_access) in **`.env.cloud.local`**. The provision script mints a per-env **`clearbolt-<env>`** key (`sending_access`) and writes **`RESEND_API_KEY`** + **`AUTH_EMAIL_FROM`** to your `--write` file. Dev defaults to `Clearbolt <onboarding@resend.dev>`; staging/prod use **`RESEND_FROM_DOMAIN`** or **`AUTH_EMAIL_FROM`**.

## One-shot setup (provision + migrate + optional smoke)

From an empty or partially configured machine (after `neonctl auth` / `wrangler login`):

```bash
# Write .env.dev, create Neon project + R2 buckets, apply migrations
pnpm cloud:setup -- --env dev --write .env.dev

# Same, plus fixture scrape smoke and BizBuySell domain mark --http (requires pnpm build first run)
pnpm build
pnpm cloud:setup -- --env dev --write .env.dev --dev-defaults --smoke

# Already provisioned: migrate only + convenience steps
pnpm cloud:setup -- --no-provision --dev-defaults --smoke
```

Runner flags: `--no-provision`, `--no-migrate`, `--dev-defaults`, `--smoke`, `--help`.  
Everything else is forwarded to `pnpm cloud:provision` (e.g. `--env`, `--write`, `--dry-run`, `--neon-only`, `--resend-only`).

## One command

```bash
# Plan only (no API calls)
pnpm cloud:provision -- --env dev --dry-run

# Put account id once (gitignored), then provision Neon + R2
echo 'CLOUDFLARE_ACCOUNT_ID=…' >> .env.cloud.local
pnpm cloud:provision -- --env dev

# Or export for one session only
export CLOUDFLARE_ACCOUNT_ID=…
pnpm cloud:provision -- --env dev

# Write gitignored env at repo root (pick one name)
pnpm cloud:provision -- --env dev --write
pnpm cloud:provision -- --env dev --write .env.dev

# Load for manual shell commands (URLs are quoted so `source` works in zsh/bash):
set -a && source .env.dev && set +a
```

Repeat with `--env staging` or `--env prod` when you are ready. Names are deterministic:

| Env       | Neon project          | R2 buckets                                                | Resend API key name   |
| --------- | --------------------- | --------------------------------------------------------- | --------------------- |
| dev       | `clearbolt-dev`       | `clearbolt-evidence-dev`, `clearbolt-wiki-dev`            | `clearbolt-dev`       |
| staging   | `clearbolt-staging`   | `clearbolt-evidence-staging`, `clearbolt-wiki-staging`    | `clearbolt-staging`   |
| prod      | `clearbolt-prod`      | `clearbolt-evidence-prod`, `clearbolt-wiki-prod`          | `clearbolt-prod`      |

`--env stage` is accepted as an alias for staging.

## Optional environment variables

| Variable              | Purpose |
| --------------------- | ------- |
| `NEON_ORG_ID`         | Passed to `neonctl projects create --org-id` if the CLI default org is wrong. |
| `NEON_REGION_ID`      | Default `aws-us-east-2` for new Neon projects. |
| `CLOUDFLARE_ACCOUNT_ID` | Required for R2 when Wrangler needs an explicit account. Put in `.env.cloud.local`, `.env.dev`, or `.env` (loaded in that order by the provision script via dotenv). |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Optional. Wrangler cannot mint them. If both are set in env, `--write` copies them into the generated file. |
| `RESEND_BOOTSTRAP_API_KEY` | Full-access Resend key used only to create `clearbolt-<env>` sending keys (not copied to output). |
| `RESEND_API_KEY` | Bootstrap fallback if bootstrap key unset; reused when `clearbolt-<env>` already exists. |
| `RESEND_FROM_DOMAIN` / `AUTH_EMAIL_FROM` | Sender for OTP mail; dev defaults to `onboarding@resend.dev`. |

## Flags

| Flag           | Meaning |
| -------------- | ------- |
| `--neon-only`  | Skip R2 and Resend (Neon only). |
| `--r2-only`    | Skip Neon and Resend (buckets only; reuse an existing `.env.cloud.*` for DB URLs). |
| `--resend-only` | Skip Neon and R2; mint Resend keys and sender only. |
| `--write`      | Write `.env.cloud.<env>` (default) or `--write path` (e.g. `.env.dev`). |

## Resend credentials

Like R2 S3 keys, Resend **cannot** mint the first account key for you. Create one **full_access** key in the [Resend dashboard](https://resend.com/api-keys) (or run `resend login` and export it) and store it as **`RESEND_BOOTSTRAP_API_KEY`** in **`.env.cloud.local`**.

```bash
# One-time in .env.cloud.local
RESEND_BOOTSTRAP_API_KEY=re_xxxxxxxx

pnpm cloud:provision -- --env dev --write .env.dev
# → RESEND_API_KEY=re_yyyy (clearbolt-dev, sending_access)
# → AUTH_EMAIL_FROM=Clearbolt <onboarding@resend.dev>
```

If **`clearbolt-<env>`** already exists, the script cannot read the old token again — keep **`RESEND_API_KEY`** in `.env.cloud.local` or delete the key in Resend and re-run provision.

## R2 credentials

**Wrangler** creates buckets using your login; it does **not** create or print **S3-compatible** keys (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`). Create them once in the dashboard (**R2 → Manage R2 API Tokens**), scoped to your buckets.

Put both keys in **`.env.cloud.local`** (gitignored). On the next `pnpm cloud:provision … --write`, the script **copies** them into the generated env file if they are present in the environment. There is still no way for Wrangler alone to mint these keys automatically.

## Manual equivalents

If you prefer not to use the script:

```bash
pnpm exec neonctl projects create --name clearbolt-dev --region-id aws-us-east-2 -o json
pnpm exec neonctl branches list --project-id <id> -o json   # pick default branch name
pnpm exec neonctl connection-string <branch> --project-id <id> --pooled
pnpm exec neonctl connection-string <branch> --project-id <id>

CLOUDFLARE_ACCOUNT_ID=… pnpm exec wrangler r2 bucket create clearbolt-evidence-dev
CLOUDFLARE_ACCOUNT_ID=… pnpm exec wrangler r2 bucket create clearbolt-wiki-dev
```

## Schema migrations

After provisioning Neon, apply Prisma migrations:

```bash
pnpm db:migrate
```

`pnpm db:migrate` loads `.env.cloud.local` → `.env.dev` → `.env` (same order as the provision script) and runs `prisma migrate deploy` in `packages/db`. Re-running on an up-to-date database is a no-op. New migrations: edit `packages/db/prisma/schema.prisma`, then `pnpm db:migrate:dev -- --name …`.

Schema history is a single baseline migration `20260518000000_init`. If an older DB still has the pre-squash migration names in `_prisma_migrations`, run **`pnpm db:reset-dev -- --confirm`** once (dev only; destroys all rows).

## CLI with cloud storage

By default the CLI writes to disk under `./data`. To use your provisioned **R2 + Neon** backends:

```bash
# Env files at repo root (gitignored)
# .env.cloud.local — long-lived secrets (CLOUDFLARE_ACCOUNT_ID, R2 keys)
# .env.dev           — provision output (DATABASE_URL, bucket names)

# Fixture scrape (offline HTML; no live BizBuySell fetch)
CLEARBOLT_STORAGE=cloud CLEARBOLT_SCRAPE_LIMIT=10 CLEARBOLT_SKIP_BROWSER=1 \
  pnpm clearbolt scrape "https://www.bizbuysell.com/businesses-for-sale/" --fixtures

pnpm clearbolt deals list
pnpm clearbolt replay
```

| Variable | Meaning |
| -------- | ------- |
| `CLEARBOLT_STORAGE=cloud` | `EvidenceStore` → R2, `MetadataStore` → Neon. Requires full creds in env. |
| `CLEARBOLT_SKIP_BROWSER=1` | HTTP-only scrape path (no Playwright). |
| `CLEARBOLT_SCRAPE_LIMIT` | Max listing detail pages per run (default `10`). |
| `DATA_DIR` | Still used for local scratch; cloud mode stores evidence/metadata remotely. |

Scrape output prints active backends when cloud is enabled, e.g. `evidence: R2` and `metadata: Neon`.

### Domain profiles on shared dev Neon

`DomainProfile.needsBrowser` is persisted in Neon like disk `data/domain/`. If a host is marked browser-required and you run with `CLEARBOLT_SKIP_BROWSER=1`, scrape aborts — including `--fixtures` runs.

```bash
# Allow HTTP/fixture scrape for BizBuySell on shared dev
CLEARBOLT_STORAGE=cloud pnpm clearbolt domain mark www.bizbuysell.com --http

# Inspect
CLEARBOLT_STORAGE=cloud pnpm clearbolt domain show www.bizbuysell.com
```

Conformance tests use a synthetic host (`conformance-fixture.example`) so they do not flip real marketplace domains.

## Validation criteria

### Functional

- **Given** authenticated `neonctl` and `wrangler`, **when** a developer runs `pnpm cloud:provision -- --env dev --dry-run`, **then** the script exits 0 and prints the intended project, bucket, and Resend API key names. Coverage: smoke. Test: manual.

- **Given** `RESEND_BOOTSTRAP_API_KEY` with full_access, **when** a developer runs `pnpm cloud:provision -- --env dev --resend-only --write .env.dev`, **then** the output file contains `RESEND_API_KEY` and `AUTH_EMAIL_FROM`. Coverage: smoke. Test: manual.

- **Given** `scripts/lib/resend-provision.mjs`, **when** `pnpm test` runs, **then** `scripts/tests/resend-provision.test.ts` passes. Coverage: unit.

- **Given** `DATABASE_URL` in `.env.dev` after a successful `--write` provision, **when** a developer runs `pnpm cloud:setup -- --no-provision`, **then** `prisma migrate deploy` runs and exits 0 on an up-to-date database. Coverage: integration. Test: `pnpm test` includes `migrate-idempotent` when env is loaded; manual for full chain.

### Docs

- **Given** this file, **when** `pnpm lint:specs` runs, **then** it exits 0 (includes `## Validation criteria`). Coverage: smoke.
