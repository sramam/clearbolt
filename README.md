# Clearbolt (V0 walking skeleton)

Local-dev scraper → dedup → disk storage. See [agents.md](./agents.md) and [docs/phases/V0.md](./docs/phases/V0.md).

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/) **10.16.1+** (see root `packageManager`; required for `minimumReleaseAge` in `pnpm-workspace.yaml`)

## Setup

```bash
pnpm install
pnpm build
```

**HTTPS (AIA):** `HttpFetcher` uses Node `https` and, on incomplete certificate chains, fetches the missing intermediate via the leaf’s AIA “CA Issuers” URL (see `packages/scraper/src/tls-aia.ts`). Integration coverage hits `incomplete-chain.badssl.com` and needs outbound network in `pnpm test`.

**Browser lane (Playwright):** after install, download Chromium once (needed for real `clearbolt scrape` when HTTP is not enough):

```bash
pnpm ensure:playwright
```

Skip in automation with `CLEARBOLT_SKIP_PLAYWRIGHT_INSTALL=1`. Tests that must avoid launching a browser use `CLEARBOLT_SKIP_BROWSER=1` (see `apps/cli` scrape smoke tests).

### Dependency release lag

We intentionally lag **~30 days (~4 weeks)** behind the newest npm releases: pnpm `minimumReleaseAge`, a lockfile verifier (`pnpm run verify:dependency-lag`), and Renovate are all aligned. Details and how to change the window: [docs/operations/dependency-lag.md](./docs/operations/dependency-lag.md).

### Contributing

Conventions, dependency lag, **TDD**, and **commit hygiene** (failing test → implement → green, small commits, pre-push checks): [agents.md](./agents.md) (*Test-driven development*, *Commit hygiene*).

## Commands

```bash
# Scrape a BizBuySell search URL (writes under ./data by default)
pnpm clearbolt scrape "https://www.bizbuysell.com/..."

# List canonical deals on disk
pnpm clearbolt deals list

# Replay from evidence only (no network) — uses stored source rows + evidence
pnpm clearbolt replay
```

Optional: [VictoriaMetrics](https://docs.victoriametrics.com/) for local metrics:

```bash
docker compose -f docker-compose.dev.yml up -d
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build all packages |
| `pnpm typecheck` | `tsc --noEmit` in each package |
| `pnpm test` | Vitest |
| `pnpm lint` | Biome |
| `pnpm lint:specs` | Advisory markdown spec checks |
| `pnpm verify:dependency-lag` | Lockfile vs npm publish dates (30-day lag policy) |
| `pnpm ensure:playwright` | Install Playwright Chromium for `@clearbolt/scraper` (browser lane) |

## Layout

- `packages/core` — shared types + Zod
- `packages/observability` — logger / tracer / metrics (minimal V0)
- `packages/storage` — `EvidenceStore` + `MetadataStore` (disk)
- `packages/dedup` — deterministic + lexical dedup
- `packages/scraper` — HTTP fetcher, throttles, WAF hints, BizBuySell adapter
- `apps/cli` — `clearbolt` entrypoint
