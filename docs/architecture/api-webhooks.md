# Public API, webhooks, and integrations

Roadmap surface (V3+). Design data so this is additive, not retrofit.

## Public API (V3+)

- Scoped tokens per workspace.
- Read-first; mutations gated.
- Better-auth issues API tokens with workspace + scope claims.
- Versioned (`/v1/...`) from day one.

## Webhooks

- Per-workspace subscriptions on events:
  - new-match (saved search produced new canonical deal in this workspace).
  - price-drop (watched deal's asking price changed).
  - status-change (watched deal moved from `active` -> `under_contract` / `withdrawn` / `sold`).
  - outreach-reply.
  - pipeline-change.
  - capture-processed (universal clipper finished extracting).
  - transcript-ready.
- Standard event payload shape (same shape across delivery channels).

## CRM integrations (V3+)

- HubSpot, Salesforce, Affinity for searchers using external CRMs.
- Bidirectional sync for deals, contacts, outreach.

## Spreadsheet round-trip

- CSV import/export.
- Google Sheets bidirectional mirror.

## Zapier / Make / n8n (V3+)

- Standard event payloads to enable user-built automations.
- Listed app on Zapier and Make once payload contracts are stable.

## Inbound

- Mirror the Inbound Channels layer (email, document upload, capture API) via API for partner ingestion.
- The V1 `POST /api/captures` (browser extension's contract) is the de-facto first public endpoint; it pre-dates the formal V3+ public API but follows the same auth and event-emission patterns.

## Auth model decisions (`TODO`)

- PAT vs OAuth?
- Per-token rate limits?
- Webhook signing scheme (HMAC w/ rotating secret)?

## Validation criteria

V3+ surface; criteria are gating conditions for first ship. Concrete tests land when the surface enters a real release.

### Functional
- **Given** a workspace API token with read-only scope, **when** a mutation request is sent, **then** the request is rejected with HTTP 403. Coverage: integration. Test: `services/api/tests/scope-enforcement.test.ts` (TBD V3).
- **Given** an API token scoped to workspace A, **when** a request asks for workspace B's resources, **then** the response is 404 (not 403 — do not leak existence). Coverage: integration. Test: `services/api/tests/cross-workspace-not-found.test.ts` (TBD V3).
- **Given** a webhook subscription on `deal.price_changed`, **when** a price change occurs, **then** the webhook fires within 60 seconds with a signed payload (HMAC-SHA256, rotating secret) and at-least-once delivery semantics. Coverage: integration. Test: `services/webhooks/tests/delivery-and-signature.test.ts` (TBD V3).
- **Given** a webhook delivery that fails (HTTP 5xx), **when** the retry policy runs, **then** retries follow exponential backoff with a 24h ceiling, after which the subscription is paused and the workspace owner is notified. Coverage: integration. Test: `services/webhooks/tests/retry-and-pause.test.ts` (TBD V3).
- **Given** a CSV import, **when** the file is uploaded, **then** the same import is idempotent — re-uploading the identical file produces zero net new records. Coverage: integration. Test: `services/import/tests/csv-idempotent.test.ts` (TBD V2/V3).
- **Given** a Google Sheets bidirectional mirror, **when** a row is edited in Sheets, **then** the change reconciles into Clearbolt within 5 minutes; conflicts surface in the workspace UI. Coverage: integration. Test: `services/sheets-mirror/tests/bidirectional-reconcile.test.ts` (TBD V3).

### Versioning
- **Given** a `/v1/...` endpoint that ships, **when** breaking changes are needed, **then** a `/v2/...` endpoint is added (no breaking change to `/v1`). Coverage: lint. Test: `services/api/tests/no-breaking-change-to-shipped-version.test.ts` (TBD V3).

### Auth
- **Given** an API token, **when** it expires or is revoked, **then** subsequent requests fail with HTTP 401 within 60 seconds of revocation (cache TTL ≤ 60s). Coverage: integration. Test: `services/api/tests/token-revocation-fast.test.ts` (TBD V3).
