# ADR 0001 — Storage split: R2 evidence + Neon metadata

Status: accepted

## Context

Source records carry both small structured metadata (URL, parser version, dedup keys, broker reference, canonical deal pointer) and large raw payloads (HTML, JSON, screenshots, PDFs). The two have very different access patterns and durability needs.

Postgres is the wrong place for blobs (cost, backup size, query-plan footguns, edge-driver size limits). A blob store is the wrong place for structured query.

## Decision

Two distinct contracts, two distinct backends:

- **`EvidenceStore`** — blobs only (raw HTML, raw audio, transcript markdown, captured pages, prompt/response artifacts, wiki-r2 snapshots). Backend: V0 disk; V1+ Cloudflare R2 (S3-compatible).
- **`MetadataStore`** — structured rows and indexes (workspaces, source records, canonical deals, brokers, captures, dedup index, audit log, queue tables). Backend: V0 disk JSON; V1+ Neon Postgres + Prisma v7.

Postgres rows reference evidence by `(bucket, key, sha256, contentType, sizeBytes)` tuples. Payloads never inlined.

R2 chosen for V1+ evidence because:

- S3-compatible (no migration cost if we ever move).
- No egress fees (replays and re-extraction are essentially free).
- Same datacenter family as Cloudflare Workers (low latency for the CF runtime).

Neon chosen for V1+ metadata because:

- Serverless Postgres (no idle cost for low-traffic workspaces).
- Branching (clean preview environments per PR).
- pgvector available in the same DB ([ADR 0011](0011-vector-pgvector-on-neon-v1.md)).
- Both CF (HTTP driver) and Fly (node-postgres) connect to the same DB.

## Consequences

- Two contracts, two implementations to swap independently. V0 -> V1 cutover happens piecewise.
- Cross-tenant scoping enforced separately in each store (R2 key prefixes; Neon `workspaceId` columns).
- Backups: Neon's automatic + R2 versioning give redundant durability stories.
- Conformance suite shared across V0/V1 backends ensures parity.

## Falsifiability criteria

- **Trigger**: any consumer package accesses raw blobs through `MetadataStore` (or structured rows through `EvidenceStore`).
  **Measurement**: `pnpm lint:specs --storage-boundary` walks `packages/*/src/**` for cross-contract calls.
  **Response**: revisit the boundary; the abstraction is leaking.
- **Trigger**: cross-store joins require app-layer round-trips that account for >50% of latency on any hot read path.
  **Measurement**: trace analysis on V1+ hot endpoints (deal page load, listing list).
  **Response**: consider denormalizing the most-joined evidence metadata (sha256, contentType, sizeBytes already are; expand if needed) into the `MetadataStore` row.
- **Trigger**: R2 egress cost becomes non-negligible (>5% of total infra spend).
  **Measurement**: monthly cost report.
  **Response**: revisit the "no egress fees" assumption — R2 may have changed pricing or our access pattern leaked outside CF/Fly.
- **Trigger**: Neon serverless cold-start latency materially impacts user experience (>2s on first request after idle).
  **Measurement**: synthetic monitoring + user-perceived latency telemetry.
  **Response**: revisit DB choice or move to a non-serverless tier on Neon.
