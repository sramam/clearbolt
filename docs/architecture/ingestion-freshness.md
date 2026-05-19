# Ingestion freshness and crawl scheduling

How Clearbolt separates **catalog discovery** (cheap, frequent) from **listing detail fetch** (expensive, tiered) to limit marketplace load while keeping the shared corpus current. Filesystem layout: [ADR 0017](../decisions/0017-scrape-run-filesystem-layout.md). Scraper mechanics: [`packages/scraper/agents.md`](../../packages/scraper/agents.md). User dealbox: [teams-projects-dealbox.md](teams-projects-dealbox.md).

## Purpose

Marketplace scrapes produce two distinct artifacts:

1. **Catalog** — the set of listing ids (and URLs) visible in a search or state catalog page walk.
2. **Detail** — full listing HTML, parse, dedup, search index, optional embeddings.

Re-fetching every detail page on every daily run does not scale (~5k+ listings × many sources). This spec defines **when** to walk catalogs, **when** to fetch details, and **how** fingerprints avoid redundant HTTP.

## Behavior

### Two-phase pipeline per scrape

Each `scrape-id` (e.g. `california-businesses-for-sale` on `bizbuysell.com`) runs on a schedule:

| Phase | Default cadence | Work |
|-------|-----------------|------|
| **Discovery** | Daily | Paginate catalog; write `runs/<run-id>/discovery/refs.json`; update per-ref catalog metadata |
| **Detail ingest** | Weekly (tiered) | HTTP/browser fetch only for refs **due**; parse; dedup; update listing index |

A single CLI invocation may run discovery only, detail only, or both (`--discover-only`, default full catalog+ingest with a **due filter**).

### Listing identity

- **Primary key:** marketplace `externalId` / `listingId` (BizBuySell: numeric segment in URL, e.g. `…/2232394/`).
- **Stable across runs** within a `scrape-id`; cross-marketplace identity remains `packages/dedup` ([ADR 0003](../decisions/0003-multi-source-preservation.md)).

### Catalog refs (`discovery/refs.json`)

Each ref is a `ListingRef` plus optional catalog metadata:

```json
{
  "url": "https://www.bizbuysell.com/business-opportunity/…/2232394/",
  "externalId": "2232394",
  "firstSeenInCatalog": "2026-05-19T12:00:00.000Z",
  "lastSeenInCatalog": "2026-05-19T12:00:00.000Z",
  "cardFingerprint": "sha256:…",
  "cardFields": {
    "title": "…",
    "askingPrice": "…",
    "location": "Los Angeles, CA"
  }
}
```

- **`cardFingerprint`:** hash of normalized visible text from the **catalog card** (not full detail). Optional V1: omit until adapter exposes card HTML.
- **Diff:** compare today’s ref set to previous run’s refs → `added`, `removed`, `unchanged` (id present, same `cardFingerprint`).

### Listing index (`listings/<listing-id>/index.json`)

Scheduling and last-known content signals (extends [ADR 0017](../decisions/0017-scrape-run-filesystem-layout.md)):

```json
{
  "version": 1,
  "listingId": "2232394",
  "adapter": "bizbuysell",
  "url": "https://www.bizbuysell.com/business-opportunity/…/2232394/",
  "status": "ingested",
  "lastAttemptRunId": 12,
  "lastSuccessRunId": 12,
  "lastDetailFetchAt": "2026-05-19T12:00:00.000Z",
  "lastBodyFingerprint": "sha256:…",
  "lastCardFingerprint": "sha256:…",
  "nextDetailFetchAt": "2026-05-26T12:00:00.000Z",
  "fetchTier": "default",
  "updatedAt": "2026-05-19T12:00:00.000Z"
}
```

| Field | Meaning |
|-------|--------|
| `lastBodyFingerprint` | From `htmlListingBodyFingerprint` after last successful detail parse |
| `lastCardFingerprint` | Last catalog card fingerprint seen for this id |
| `nextDetailFetchAt` | Do not detail-fetch before this time unless override |
| `fetchTier` | `default` \| `dealbox` \| `new` |

### Fetch tiers and intervals

| Tier | Set membership | Discovery | Detail fetch |
|------|----------------|-----------|--------------|
| **`new`** | In catalog `added` since previous discovery run | Daily | As soon as scheduled (same day) |
| **`default`** | In corpus, not dealbox | Daily catalog sighting | **Weekly** (`nextDetailFetchAt`) |
| **`dealbox`** | Any canonical listing in a user’s dealbox for any workspace | Daily | **Daily** |

**Dealbox source of truth (V1+):** `UserProjectDisposition` with `bucket = dealbox` ([teams-projects-dealbox.md](teams-projects-dealbox.md)), keyed by `canonicalId` → resolve to `externalId` + adapter for the scheduler queue. V0: env allowlist `CLEARBOLT_DETAIL_FETCH_DAILY_IDS` or project export file until Neon path ships.

**Overrides (always fetch detail):**

- `--refresh` / explicit operator refresh
- `cardFingerprint` changed since `lastCardFingerprint`
- `nextDetailFetchAt` in the past
- Retry of `status: failed` (`--retry-failures-only`)

### Skip reasons (detail phase)

When a ref is not fetched, record in `run.json.thisRun` counters:

| Skip | Condition |
|------|-----------|
| `skipped_not_due` | `now < nextDetailFetchAt` and card unchanged |
| `skipped_known` | Already satisfied and `CLEARBOLT_LISTING_FETCH_SKIP_KNOWN=1` (resume) |
| `skipped_fresh` | Fetched but `bodyFingerprint` unchanged vs `lastBodyFingerprint` (no canonical content update) |

Existing env ([`.env.example`](../../.env.example)):

- `CLEARBOLT_LISTING_FETCH_COOLDOWN_HOURS` — default detail minimum interval (proposed default: **168** = 7d for `default` tier; dealbox uses **24**).
- Tier-specific overrides: `CLEARBOLT_LISTING_FETCH_COOLDOWN_DEALBOX_HOURS`, `CLEARBOLT_LISTING_FETCH_COOLDOWN_NEW_HOURS`.

### Detail artifacts (per fetch)

When detail **is** fetched, write under the listing run (see ADR 0017 addendum):

```text
listings/<listing-id>/runs/<run-id>/
  manifest.json       # evidenceRef, processed keys, fingerprints
  listing.html        # co-located raw (optional duplicate of content-addressed blob)
  structured.json     # optional co-located processed
  listing.md
```

Global `raw/<adapter>/<sha256>.html` remains the **dedup-backed** evidence store ([ADR 0001](../decisions/0001-storage-split.md)); co-located files are for operator ergonomics and replay.

### `scrape.json` cumulative (extended)

```json
{
  "cumulative": {
    "discovered": 5339,
    "detailFetched": 120,
    "ingested": 4722,
    "failed": 313,
    "skippedKnown": 304,
    "skippedFresh": 890,
    "skippedNotDue": 4100,
    "satisfied": 5026
  }
}
```

`discovered` = union of ids ever seen in catalog; detail counters reflect **scheduling**, not duplicate discovery.

### Orchestration (V1+)

- **Daily job:** per `scrape-id` → discovery run → enqueue detail for `new ∪ dealbox ∪ due(default)`.
- **Parallelism:** one discovery run per state/region `scrape-id`; detail workers cap concurrency (existing proxy limits).
- **Queue:** `packages/queue` / pg-boss ([open.md](../decisions/open.md)); V0 CLI runs the same logic inline.

## Relationship to dedup

| Mechanism | Scope |
|-----------|--------|
| Catalog / body fingerprints | Same **listing id** — skip redundant HTTP |
| `bodyFingerprint` on `SourceRecord` | `contentUpdated` when merged canonical’s body changes |
| Dedup keys / vector | Same **business** across listings and sources |

Catalog hash does **not** replace dedup; it reduces fetch volume before dedup runs.

## Counter-examples

- Re-fetching all details daily for an entire state catalog without tier or fingerprint gates.
- Using catalog fingerprint alone to skip detail when the card omits price changes that only appear on the detail page (mitigation: weekly `nextDetailFetchAt` still fires; card change forces early fetch).
- Storing only co-located `listing.html` without content-addressed evidence (breaks replay contract and cross-URL dedup).

## Open questions

- [ ] Exact catalog card HTML/selectors per adapter for `cardFingerprint`. Resolved when each adapter documents card parse in `adapters/<source>/agents.md`.
- [ ] Whether `removed` catalog ids mark canonical deals inactive or only stop refresh. Resolved in listing lifecycle ADR / `DealEvent` work ([open.md](../decisions/open.md)).
- [ ] Global rollup dashboard across 50 state scrapes vs per-`scrape-id` only. V1 ops UI.

## ADRs

- [0001](../decisions/0001-storage-split.md) — evidence blobs
- [0003](../decisions/0003-multi-source-preservation.md) — append-only sources
- [0017](../decisions/0017-scrape-run-filesystem-layout.md) — `scrapes/` tree

## Validation criteria

### Functional

- **Given** a listing with `fetchTier: default`, `nextDetailFetchAt` tomorrow, and unchanged `cardFingerprint`, **when** a detail ingest batch runs without `--refresh`, **then** the listing is not HTTP-fetched and `thisRun.skippedNotDue` increments. Coverage: integration. Test: `packages/scraper/tests/listing-fetch-schedule.test.ts` (TBD).
- **Given** a listing in the dealbox tier, **when** daily detail scheduling runs, **then** it is included even if `nextDetailFetchAt` is in the future. Coverage: integration. Test: `packages/scraper/tests/listing-fetch-schedule.test.ts::dealbox_daily` (TBD).
- **Given** catalog run N adds ref id `X` not in run N−1, **when** discovery diff runs, **then** `X` has `fetchTier: new` and is eligible for detail the same day. Coverage: unit. Test: `packages/scraper/tests/catalog-discovery-diff.test.ts` (TBD).
- **Given** a detail fetch whose `htmlListingBodyFingerprint` equals `lastBodyFingerprint`, **when** ingest completes, **then** status may be `skipped_fresh` and dedup `contentUpdated` is false. Coverage: integration. Test: existing `packages/dedup/tests/ingest-content-updated.test.ts` + ingest pipeline (TBD wire).
- **Given** `cardFingerprint` differs from `lastCardFingerprint` and tier is `default`, **when** detail scheduling runs before `nextDetailFetchAt`, **then** the listing is fetched. Coverage: unit. Test: `packages/scraper/tests/listing-fetch-schedule.test.ts::card_change_forces_fetch` (TBD).

### Non-functional

- **Given** a corpus of 5k listings with default weekly detail, **when** a daily discovery-only run executes, **then** HTTP listing detail requests are O(new + dealbox + due) per day, not O(5k). Coverage: integration + metrics. Test: run summary `skippedNotDue` ≥ 80% of corpus (TBD benchmark fixture).

### Failure modes

- **Given** dealbox query fails, **when** daily detail runs, **then** dealbox tier falls back to empty set and logs warning; default/new tiers still run. Coverage: integration. Test: `packages/scraper/tests/listing-fetch-schedule.test.ts::dealbox_fallback` (TBD).
