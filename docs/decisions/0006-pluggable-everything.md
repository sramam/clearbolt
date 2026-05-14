# ADR 0006 — Pluggable everything: contracts in domain packages, swappable backends as siblings

Status: accepted

## Context

V0 must run on a laptop with disk-only storage and no cloud deps. V1+ runs on hybrid Cloudflare + Fly.io with Neon, R2, pgvector, AI Gateway, MCP servers, container sandboxes. The application code in between cannot care.

If V0 hard-codes disk paths, V1 is a rewrite. If V1 backends are stuffed into the same packages as V0 defaults, V0 inherits heavy deps and CF Worker bundles balloon.

## Decision

Every domain package owns one or more **contracts** (TypeScript interfaces) and ships a default V0 backend that satisfies them. Heavier backends live as **sibling packages**:

- `packages/storage` defines `EvidenceStore`, `MetadataStore`, `WikiStore`. Ships disk default.
- `packages/storage-r2`, `packages/storage-neon`, `packages/wiki-fs`, `packages/wiki-r2` are sibling packages with the V1+ backends.
- Same for `Fetcher` (siblings: `apify` later), `Sandbox` (siblings: `daytona`, `e2b`, `vercel-sandbox`), `Embedder` (siblings per provider), `Queue` (siblings per backend), etc.

Application code depends only on contracts. A small `bind*` factory in each contract package selects the backend at startup based on env / config.

## Consequences

- V0 ships with minimal dependencies. CF Worker bundles for V1 only include the backends they actually use.
- Adding a new backend (Supabase, GCS, S3, Qdrant, Pinecone, ...) is a sibling package addition, not an invasive refactor.
- Conformance test suite per contract; new backends prove parity by passing the same tests.
- Slightly more package proliferation than a "kitchen sink" approach. Worth it for the optionality.

## Falsifiability criteria

- **Trigger**: adding a new backend for any contract requires modifying more than 2 consumer packages.
  **Measurement**: PR diff stat in the contract package + each backend package; if a `packages/storage-supabase` PR also touches `packages/dedup` or `apps/cli`, the principle is failing.
  **Response**: revisit the contract; the abstraction is leaking.
- **Trigger**: any consumer package imports a backend package directly (instead of resolving via `bind*()`).
  **Measurement**: `pnpm lint:specs --no-direct-backend-imports` walks consumer imports for sibling-backend package names.
  **Response**: revisit the consumer; refactor through the contract.
- **Trigger**: a contract grows runtime branches (`if (backend === 'r2') ...`) inside the consumer.
  **Measurement**: lint over consumer packages for backend identity checks.
  **Response**: incident; the abstraction failed to encapsulate the difference.
- **Trigger**: a new backend ships without a passing run of the contract's conformance suite.
  **Measurement**: `scripts/lint-specs.mjs::backend_invokes_conformance_suite` (TBD V1).
  **Response**: hold the backend; conformance is the basis of substitutability.
