# ADR 0012 — Multi-tenancy: workspaces are the tenant boundary

Status: accepted

## Context

Clearbolt is multi-tenant from V1 even when early users are solo. Eventually a user can belong to multiple workspaces (analyst supporting multiple searchers, search-fund team, holdco, advisor multi-client). Strict isolation is required between workspaces to protect financial profile data, captures, outreach state, and per-deal wiki content.

Two boundary candidates:

- **User as tenant** — simpler permissions; harder collaboration story; awkward for shared workspaces.
- **Workspace as tenant** — natural collaboration unit; matches the product's "shared cache + private workspace" principle; aligns with better-auth's organizations feature.

## Decision

**Workspaces are the tenant boundary.** Tooling:

- Better-auth's organizations feature backs `Workspace`. Memberships and roles are first-class.
- Better-auth tokens carry `workspaceId` (the active workspace) in their claims. Validated identically by CF Worker and Fly Node runtimes via [`packages/auth`](../../packages/auth/agents.md).
- Every workspace-scoped table in Neon carries a `workspaceId String` column with FK to `Workspace.id` and an index that includes `workspaceId` first.
- Every R2 key for workspace-private data carries a workspace prefix: `workspaces/<workspaceId>/<rest>`.
- Background workers must respect workspace scoping — the `MetadataStore` sub-stores require an explicit workspace context for any workspace-scoped op.
- The shared listing cache (canonical deals, brokers, listing snapshots) lives in non-workspace-scoped tables and is read-only from inside any workspace's wiki.
- Cross-workspace sharing must be explicit and audit-logged (e.g. shared comps in V3).

Roles: `owner`, `admin`, `member`, `viewer`. Tighter scopes (e.g. "outreach only") added later.

## Consequences

- Cross-tenant isolation tested in CI with cross-tenant fixtures.
- Multi-workspace UX (header dropdown, switch active workspace) is first-class.
- Provider lead generation (V3+) can be designed cleanly: opt-in per workspace, audit-logged per consent event.
- Adding row-level security (Neon supports Postgres RLS) is possible later as a defense-in-depth layer; V1 enforces at the application layer.
- A user belonging to multiple workspaces gets a clean re-auth flow (token reissue with new workspace claim) rather than carrying global cross-workspace state.

## Falsifiability criteria

- **Trigger**: cross-tenant data leak detected — any workspace observing another workspace's data via the application surface.
  **Measurement**: cross-tenant fixture tests in CI (`apps/web/tests/tenant-isolation/*.test.ts`); production telemetry on suspicious queries.
  **Response**: critical incident; remediate the leak; consider adding Postgres RLS as defense-in-depth.
- **Trigger**: more than 10% of users belong to >5 workspaces.
  **Measurement**: telemetry on `workspace_membership` aggregations.
  **Response**: revisit workspace boundary; the unit may be too granular and a "deal" or "search-fund" higher-level grouping may be needed.
- **Trigger**: better-auth organizations feature is deprecated or significantly changed (breaking API).
  **Measurement**: vendor update tracking.
  **Response**: implement workspace identity ourselves on top of better-auth's user model, or migrate to an alternative.
- **Trigger**: a background worker writes to a workspace-scoped table without an explicit `workspaceId` context (the contract guard breaks).
  **Measurement**: lint over `MetadataStore` sub-store usage; runtime assertion in the sub-store implementation.
  **Response**: incident; restore the guard.
- **Trigger**: a token issued for workspace A is accepted for a request to workspace B's data.
  **Measurement**: `packages/auth/tests/token-scope.test.ts`; production fuzz testing.
  **Response**: critical incident; auth boundary failure.
