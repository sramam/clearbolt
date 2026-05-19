# `apps/scraper-service`

> Runtime: **node** (Fly.io in production; local via `pnpm scraper-service:dev`). Thin HTTP wrapper around [`packages/scraper`](../../packages/scraper/agents.md) scrape pipelines so the web app and other clients do not spawn Playwright in-process.

## Why it exists

Playwright, proxy rotation, and long catalog walks need a long-lived Node process on Fly. [`apps/web`](../web/agents.md) calls this service when `CLEARBOLT_SCRAPER_SERVICE_URL` is set (see repo-root [`.env.example`](../../.env.example)).

## API

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/health` | — | `{ ok: true, service: "clearbolt-scraper" }` |
| `POST` | `/v1/bizbuysell/scrape` | `{ searchUrl, searchKeywords?, limit?, useFixtures?, discovery?, skipBrowser? }` | `application/x-ndjson` progress lines + final `result` |
| `POST` | `/v1/bizbuysell/catalog-scrape` | `{ catalogUrl, maxPages?, maxListings?, ingestLimit?, useFixtures?, skipBrowser?, preferMobile? }` | same NDJSON stream |

**Auth:** optional `Authorization: Bearer <CLEARBOLT_SCRAPER_SERVICE_SECRET>` when the secret env var is set on the server (same value on web + Fly).

**Scrape routing:** `POST /v1/bizbuysell/scrape` with a catalog URL (`*-businesses-for-sale`) and `discovery !== "serper"` is handled as a catalog scrape (same as `/v1/bizbuysell/catalog-scrape`).

**Storage:** `bind-storage.ts` mirrors CLI/web — disk under `DATA_DIR` or Neon + R2 when `CLEARBOLT_STORAGE=cloud` and cloud env vars are present.

**Port:** `PORT` (default `8791`). Env load order: `.env.cloud.local` → `.env.dev` → `.env` at repo root.

## Deploy

- Config: [`fly.toml`](fly.toml), [`Dockerfile`](Dockerfile).
- Root script: `pnpm scraper-service:dev` (builds scraper + service, runs dev server).
- Bootstrap: [docs/operations/cloud-bootstrap.md](../../docs/operations/cloud-bootstrap.md).

## Validation criteria

- **Given** the service is running, **when** `GET /health` is called, **then** HTTP 200 and `ok: true`. Coverage: smoke. Test: manual / deploy check.
- **Given** `CLEARBOLT_SCRAPER_SERVICE_SECRET` is set on the server, **when** `POST /v1/bizbuysell/scrape` omits or mismatches the Bearer token, **then** HTTP 401. Coverage: integration. Test: TBD.
- **Given** a valid scrape request with fixtures enabled, **when** the NDJSON stream completes, **then** a line with `step: "result"` appears before `step: "done"`. Coverage: integration. Test: TBD (wire against `runBizBuySellScrape` fixtures).
