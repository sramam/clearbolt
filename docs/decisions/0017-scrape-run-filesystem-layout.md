# ADR 0017 — Scrape-run filesystem layout (`data/scrapes/`)

Status: accepted

## Context

V0 stores scrape artifacts under a flat `DATA_DIR` tree (`raw/<adapter>/`, `listing-ingest-state/<adapter>/`, `catalog-refs/`, `ingest-failures/<adapter>.json`). That layout:

- Does not group artifacts by **scrape campaign** (e.g. California catalog vs Texas vs IBBA brokers).
- Couples **listing** and **broker** work implicitly even though broker directory crawls are infrequent and asynchronous.
- Makes operator debugging and one-time migration risky (in-place edits).

We need a run-scoped layout with **cumulative scrape state**, per-listing indexes for resume/retry, and **manifest pointers** to content-addressed evidence (unchanged blob store per [ADR 0001](0001-storage-split.md)).

## Decision

### Lanes

Two top-level lanes under `DATA_DIR/scrapes/`:

| Lane | Path | Use |
|------|------|-----|
| `listings` | `scrapes/listings/<domain>/<scrape-id>/` | Marketplace catalog + listing ingest |
| `brokers` | `scrapes/brokers/<domain>/<scrape-id>/` | Broker directories (IBBA, BBS broker dir), broker-site crawls |

`<domain>` is the registrable host (`bizbuysell.com`, `ibba.org`). `<scrape-id>` is a stable slug (catalog path segment, directory query slug). **Adapter id** lives in `scrape.json`, not the path.

### Per-scrape tree (listings lane)

```text
scrapes/listings/<domain>/<scrape-id>/
  scrape.json                 # cumulative + nextRunId
  runs/<run-id>/run.json      # status + thisRun counts
  runs/<run-id>/discovery/refs.json
  listings/<listing-id>/index.json
  listings/<listing-id>/runs/<run-id>/manifest.json
```

- **`run-id`**: positive integers per scrape (`1`, `2`, …), allocated from `scrape.json.nextRunId`.
- **Success**: per listing via `index.json.lastSuccessRunId`, not “max run-id globally”.
- **`scrape.json.cumulative`**: current world state for the scrape (recomputed from listing indexes at end of run).
- **Blobs**: remain content-addressed under `raw/<adapter>/` and `processed/<adapter>/` (or R2 `shared/`). Manifests hold `EvidenceRef` pointers only.

### Brokers lane

Same `scrape.json` / `runs/<run-id>/` pattern; entity subtree is `brokers/<broker-id>/` instead of `listings/<listing-id>/`. Broker-site listing ingests may add `listings/` under that broker scrape.

### Migration cutover (local V0)

1. Stop writers; `mv data data1` (preserve snapshot).
2. `mkdir data`; run `pnpm migrate:scrape-layout` with `DATA_DIR_SOURCE=data1`, `DATA_DIR=data`.
3. Validate cumulative counts vs `data1` listing-ingest-state.
4. Symlink or copy blobs: `ln -s ../data1/raw data/raw` (and `processed` if needed) until blobs are copied into `data/`.
5. Point `DATA_DIR=data`; adapters write only the new layout.
6. Phase 2: Neon/R2 pointer backfill from manifests.
7. Delete migration script after validation; keep `data1` until archived.

### National scale

Multiple listing scrapes (e.g. per-state catalog `scrape-id`), orchestrated in parallel for daily jobs. No single “all US” folder required; optional rollup is derived metadata only.

### Addendum: catalog + tiered detail refresh

Full policy: [ingestion-freshness.md](../architecture/ingestion-freshness.md).

**Catalog is still required.** Each discovery run writes `runs/<run-id>/discovery/refs.json` (listing ids + URLs). Daily jobs primarily extend or diff the catalog; they do not imply fetching every detail page.

**Fingerprints (two layers):**

| Layer | When | Field | Purpose |
|-------|------|-------|---------|
| Catalog card | Discovery walk | `cardFingerprint` on each ref | Detect card-level changes; optional early detail |
| Listing body | After detail fetch | `lastBodyFingerprint` on `index.json` | Skip redundant parse/dedup; `skipped_fresh` |

Dedup across listing ids remains `packages/dedup` (`bodyFingerprint` on `SourceRecord`). Catalog fingerprints reduce HTTP only.

**Detail fetch tiers:**

| Tier | Detail interval |
|------|-----------------|
| `new` (first seen in catalog) | Same day as discovery |
| `default` | Weekly (`nextDetailFetchAt`, default 168h) |
| `dealbox` (user promoted) | Daily (24h) |

Discovery runs **daily** for each active `scrape-id`. Detail runs process `added ∪ dealbox ∪ due(default) ∪ failed-retry`, not the full ref list.

**Co-located listing files (planned):** when detail is fetched, also write `listings/<id>/runs/<run-id>/listing.html` (and optional processed siblings). Global `raw/<adapter>/<sha256>.html` stays for content-addressed dedup per ADR 0001.

**Extended `index.json` fields:** `lastDetailFetchAt`, `lastBodyFingerprint`, `lastCardFingerprint`, `nextDetailFetchAt`, `fetchTier` (see ingestion-freshness.md).

**Extended `scrape.json` cumulative:** `detailFetched`, `skippedNotDue`, `skippedFresh` (alongside existing ingested/failed/skippedKnown).

## Alternatives considered

1. **Single tree mixing listings + brokers under one `scrape-id`.** Rejected — broker work is not synchronous with listing catalog runs.
2. **Run-id = ISO timestamp.** Rejected — integers are simpler for “latest attempt” and operator reference; timestamps live in `run.json`.
3. **Duplicate HTML into every listing folder.** Rejected for migration — manifest pointers; optional copy later.
4. **Replace content-addressed evidence with listing-only paths.** Rejected — breaks dedup and ADR 0001.

## Consequences

- `packages/scraper/src/scrape-paths.ts` owns path resolution and JSON schemas.
- `adapter-scoped-paths.ts` remains during transition; callers migrate to `scrape-paths`.
- Listing ingest state dual-read: new `index.json` first, legacy `listing-ingest-state/` fallback until migration completes.
- Docs: [storage.md](../architecture/storage.md), [ingestion-freshness.md](../architecture/ingestion-freshness.md), [packages/scraper/agents.md](../../packages/scraper/agents.md).
- Scheduler / tier logic not implemented in V0 CLI yet; spec precedes `listing-fetch-schedule` tests.

## Falsifiability criteria

- **Trigger:** Post-migration `cumulative.ingested` (and `failed`, `skippedKnown`) disagree with `data1` `listing-ingest-state` counts by more than 0.5%.
  **Measurement:** `pnpm migrate:scrape-layout --check` or migration test harness.
  **Response:** fix migration; do not delete `data1` or migration script until green.
- **Trigger:** Resume/retry after cutover reads legacy paths only and skips satisfied listings incorrectly.
  **Measurement:** integration test `retry-failures-only` uses new `index.json`.
  **Response:** fix dual-read; block cutover.
- **Trigger:** Disk usage exceeds 2× pre-migration for unchanged corpus because migration copied all raw HTML.
  **Measurement:** `du -sh data data1` after migrate without symlink step.
  **Response:** manifest-only policy enforced; remove duplicate copy step.

## Validation criteria

- **Given** `scrapeIdFromCatalogUrl("https://www.bizbuysell.com/california-businesses-for-sale/")`, **when** called, **then** returns `california-businesses-for-sale`. Coverage: unit. Test: `packages/scraper/tests/scrape-paths.test.ts`.
- **Given** a new scrape with `nextRunId: 1`, **when** `allocateNextRunId` runs, **then** returns `1` and persists `nextRunId: 2`. Coverage: unit. Test: `packages/scraper/tests/scrape-paths.test.ts`.
- **Given** migrated BizBuySell CA data from `data1`, **when** `scripts/migrate-scrape-layout.mjs` completes, **then** `data/scrapes/listings/bizbuysell.com/california-businesses-for-sale/scrape.json` exists and `cumulative.ingested` matches source. Coverage: integration. Test: manual + script `--check`.
- **Given** the tier policy in [ingestion-freshness.md](../architecture/ingestion-freshness.md), **when** a daily ingest runs without `--refresh`, **then** at least 80% of an established corpus is not detail-fetched (`skippedNotDue` or `skipped_known`). Coverage: integration. Test: `packages/scraper/tests/listing-fetch-schedule.test.ts` (TBD).
