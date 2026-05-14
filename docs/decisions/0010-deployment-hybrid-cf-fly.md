# ADR 0010 — Production deployment: hybrid Cloudflare + Fly.io

Status: accepted

## Context

V1+ production needs:

- Globally low-latency client-facing endpoints (capture POST, hot reads).
- Heavy backend compute (Playwright scraper, ffmpeg + Whisper transcribe, long-running multi-tool agent runners).
- A single source of truth for structured data (Postgres + pgvector).
- A single source of truth for blobs (S3-compatible).
- Better-auth for tenant-aware identity.

Surveyed three deployment shapes:

- **All Cloudflare**: CF Pages + Workers + Workflows + Browser Rendering + Vectorize + R2 + Durable Objects. Beautiful for the request path. Browser Rendering at our volume is more expensive than Fly Playwright. Native binaries (ffmpeg, faster-whisper) don't run. Complex multi-tool agent runs hit Workers' CPU/time caps unless wrapped in Workflows; Workflows are good but add another framework.
- **All Fly.io**: Node everywhere. Comfortable for the heavy backend. CF-quality global edge for client routes is harder; we'd be on Fly's CDN/anycast tier which is good but not Cloudflare.
- **Hybrid**: CF for the client-facing edge, Fly for the heavy backend, Neon + R2 + better-auth shared.

## Decision

**Hybrid Cloudflare + Fly.io.**

- **CF Pages**: Next.js web app.
- **CF Workers**: latency-critical edge endpoints (capture POST, hot read APIs).
- **Fly.io**: scraper (got + Playwright), transcribe (ffmpeg + faster-whisper), agent runners (wiki maintainer, ranker, quality scorer), queue worker (pg-boss), write/mutation API.
- **Neon (Postgres + pgvector)**: source of truth. CF via Neon HTTP driver; Fly via node-postgres.
- **R2**: blobs + wiki markdown. Both runtimes use S3 SDK.
- **better-auth**: tokens validated identically on both sides.

Boundary contract:

- CF reads from Neon directly (HTTP driver).
- CF writes go via the queue (writes pg-boss tables on Neon; Fly consumes).
- Fly never calls CF.
- Auth validation is local on both sides with the same secret.

Detailed topology: [`docs/architecture/deployment.md`](../architecture/deployment.md).

## Consequences

- Edge latency is excellent for client routes; backend can use any Node native dep without constraint.
- Two platforms to operate; two CI/CD targets; two log streams. Acceptable tradeoff for engineering velocity.
- Cross-cloud calls cost ~50-100ms; minimized by the boundary contract.
- Cost: compute is 5-15% of total spend; AI dominates. Topology choice is rounding error against AI spend.
- Revisit if Browser Rendering becomes cheap enough to beat Fly Playwright, or if CF gains a runtime extension for native binaries (ffmpeg, Whisper). Tracked in [open.md](open.md).

## Falsifiability criteria

- **Trigger**: cross-cloud RPC (CF Worker → Fly write API) latency p95 exceeds 200ms sustained over 7 days.
  **Measurement**: `traceparent`-correlated spans across CF and Fly.
  **Response**: revisit boundary contract; consider moving more reads to Fly or accepting the latency for the value of the global edge.
- **Trigger**: total infra cost exceeds 20% of total spend (vs the 5-15% baseline; AI is supposed to dominate).
  **Measurement**: monthly cost report.
  **Response**: revisit topology; specifically check whether Fly machine sizing or CF Workers paid-plan tier is misconfigured.
- **Trigger**: any Fly worker requires a Cloudflare-only API (Vectorize, Durable Objects).
  **Measurement**: code review on every Fly worker addition.
  **Response**: either move the capability to CF (re-architect the worker) or find a non-CF equivalent (Postgres for Durable Objects, pgvector for Vectorize).
- **Trigger**: CF Browser Rendering becomes cheaper per session than Fly Playwright at our sustained volume.
  **Measurement**: cost-per-rendered-page comparison run quarterly.
  **Response**: revisit; may move scraper browser lane to CF.
- **Trigger**: CF ships a runtime extension that supports ffmpeg or Whisper natively at acceptable cost.
  **Measurement**: vendor-feature review (quarterly).
  **Response**: revisit transcribe placement; may consolidate.
- **Trigger**: better-auth token validation diverges between CF and Fly (different runtime semantics).
  **Measurement**: cross-runtime conformance test in `packages/auth/tests/cross-runtime-token-validation.test.ts`.
  **Response**: incident; the topology assumes identical auth semantics on both sides.
