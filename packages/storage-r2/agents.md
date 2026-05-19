# `packages/storage-r2`

> Runtime: **both**. R2 / S3-compatible backend for `EvidenceStore`. V1+ only.

Implements [`packages/storage`](../storage/agents.md)'s `EvidenceStore` contract against Cloudflare R2 (preferred) or any S3-compatible bucket.

## Why a sibling package

Cloudflare R2 (and the AWS SDK) are heavy deps. Keeping them out of `packages/storage` means V0 has zero R2 deps and CF Workers don't pay the cost unless they bind this backend.

## Backend choices

Two ways to talk to R2:

- **AWS SDK v3 with R2's S3-compatible endpoint**: works on both Node (Fly) and CF Workers. Most flexible.
- **Cloudflare R2 binding** (`env.MY_BUCKET`): only on Workers, more efficient there. Optional second internal implementation if perf demands it.

Default: AWS SDK v3 against R2's S3-compatible endpoint. Same code on Fly and CF.

## Key conventions

- Workspace-private: `workspaces/<workspaceId>/<sub-area>/<sha256>.<ext>` where `<sub-area>` ∈ {`captures`, `documents`, `wiki-snapshots`, ...}.
- Per-user artifacts under the same workspace (e.g. personal dataroom copies, drafts): `workspaces/<workspaceId>/users/<userId>/<sub-area>/…` where `<userId>` is better-auth **`User.id`**, never email ([`packages/storage`](../storage/agents.md), [`teams-projects-dealbox`](../../docs/architecture/teams-projects-dealbox.md)).
- Shared cache: `shared/<adapter>/<sha256>.<ext>`.
- Content-addressed by sha256 inside each prefix so duplicates dedupe naturally.

## Lifecycle rules

- Derived/temporary artifacts (LLM caches, intermediate transcripts before quality gate) get a TTL via R2 lifecycle rules.
- Primary source payloads have **no auto-delete**. Retention is governed by explicit policy in `MetadataStore`, not by the bucket.

## Conformance

Implements the full `EvidenceStore` conformance suite from `packages/storage`. CI runs the suite against a real R2 bucket on every PR that touches this package.

## When to use what

- **Fly Node**: `packages/storage-r2` via AWS SDK v3.
- **CF Workers**: `packages/storage-r2` via AWS SDK v3 (with `fetch`-compatible HTTP) or via the R2 binding if performance benchmarks require it.

## Validation criteria

### Conformance
- **Given** the `R2EvidenceStore` backend, **when** the `EvidenceStore` conformance suite from `packages/storage/src/conformance/evidence.suite.ts` runs against a real R2 test bucket, **then** all assertions pass. Coverage: integration. Test: `packages/storage-r2/tests/conformance.test.ts`.

### Key conventions (hard rule)
- **Given** any workspace-scoped put, **when** the key is generated, **then** it carries the `workspaces/<workspaceId>/<sub-area>/<sha256>.<ext>` prefix. Coverage: integration. Test: `packages/storage-r2/tests/workspace-key-prefix.test.ts` (TBD V1).
- **Given** any shared-cache put, **when** the key is generated, **then** it carries the `shared/<adapter>/<sha256>.<ext>` prefix. Coverage: integration. Test: `packages/storage-r2/tests/shared-key-prefix.test.ts`.
- **Given** the same payload put twice, **when** complete, **then** R2 stores it once (sha256 collision is a no-op). Coverage: integration. Test: `packages/storage/src/conformance/evidence.suite.ts` via `packages/storage-r2/tests/conformance.test.ts`.

### Cross-runtime equivalence
- **Given** the `R2EvidenceStore` invoked via AWS SDK v3 from CF Workers, **when** it puts an object, **then** the same object is readable via AWS SDK v3 from Fly Node, byte-identical. Coverage: integration. Test: `packages/storage-r2/tests/cross-runtime-rw.test.ts` (TBD V1).

### Lifecycle
- **Given** a derived/temporary artifact (LLM cache, intermediate transcript), **when** the configured TTL expires, **then** the R2 lifecycle rule deletes it. Coverage: smoke. Test: `packages/storage-r2/tests/lifecycle-temp-artifacts.test.ts` (TBD V1.5).
- **Given** a primary source payload, **when** any time elapses, **then** R2 lifecycle never auto-deletes it; deletion only via explicit `MetadataStore` retention policy. Coverage: smoke. Test: `packages/storage-r2/tests/source-no-auto-delete.test.ts` (TBD V1).

### Tenant isolation
- Inherits cross-tenant isolation tests from `packages/storage/src/conformance/tenant-isolation.suite.ts`. Cross-link.
