# `packages/auth`

> Runtime: **both**. Better-auth wrapper. Same library validates tokens on CF Workers and Fly Node.

Wraps [better-auth](https://www.better-auth.com/) with Clearbolt-specific defaults: workspaces/orgs as tenant boundary, pluggable social providers, token shape that both runtimes validate identically.

ADR: [`docs/decisions/0012-multi-tenancy-workspace-as-tenant.md`](../../docs/decisions/0012-multi-tenancy-workspace-as-tenant.md).

## Why a wrapper

- Hide better-auth's lifecycle quirks behind a Clearbolt-shaped API (`requireAuth`, `requireWorkspaceMember`, `requireRole`).
- Centralize the token-claim shape so any service can validate identically.
- Pre-wire the orgs/workspaces feature with our naming.
- Pre-wire social providers chosen by the team (Google + GitHub + email/password to start).

## Token-claim shape

```ts
interface ClearboltClaims {
  userId: string;
  workspaceId: string;          // currently active workspace
  workspaceRole: 'owner' | 'admin' | 'member' | 'viewer';
  scopes?: string[];            // for API tokens
  iat: number;
  exp: number;
}
```

The token is a better-auth session JWT plus our claim shape. Validation on either runtime returns the same `ClearboltClaims`.

## API surface

```ts
// On CF Worker:
import { requireAuth, requireWorkspaceMember } from '@clearbolt/auth/workers';
const claims = await requireWorkspaceMember(req, env);

// On Fly Node:
import { requireAuth, requireWorkspaceMember } from '@clearbolt/auth/node';
const claims = await requireWorkspaceMember(req);
```

Both surfaces accept the same token, return the same `ClearboltClaims`, and throw the same `AuthError` types.

## Workspaces / orgs

Better-auth's organizations feature backs `Workspace`. Memberships and roles are first-class.

- Inviting a user to a workspace: `auth.api.invite({ workspaceId, email, role })`.
- Switching active workspace: `auth.api.switchWorkspace({ userId, workspaceId })` -> reissue token with new claim.
- Multi-workspace UX: header dropdown in the web app; persists active workspace per session.

## Social providers

V1: Google, GitHub, email + password. Better-auth handles the OAuth dance.

V2+: pluggable additional providers based on customer demand (Microsoft, Apple, SAML/OIDC for team accounts).

## Where it runs

- **CF Pages / Workers**: validates tokens for session-bound web routes and the `POST /api/captures` endpoint.
- **Fly Node**: validates tokens for the write API and any agent runners that need workspace context.

## Schema

User and Membership tables managed by better-auth. `Workspace` extension fields managed by us in `packages/storage-neon` schema (see [`docs/architecture/data-model.md`](../../docs/architecture/data-model.md)).

## Phasing

- V0: not used (no auth in V0; single hardcoded workspace identifier for the disk-backed walking skeleton).
- V1: full auth shipped (Google + GitHub + email/password, workspaces, roles, invites).
- V2: SSO/SAML, finer-grained scopes (e.g. "outreach only").

## Validation criteria

### Cross-runtime token validation (hard rule)
- **Given** a token issued by the auth provider, **when** validated on CF Workers via `@clearbolt/auth/workers` and on Fly Node via `@clearbolt/auth/node`, **then** both return identical `ClearboltClaims` (same `userId`, `workspaceId`, `workspaceRole`, `scopes`, `iat`, `exp`). Coverage: integration. Test: `packages/auth/tests/cross-runtime-token-validation.test.ts` (TBD V1).
- **Given** an invalid or expired token, **when** validated on either runtime, **then** the same `AuthError` subtype is thrown. Coverage: integration. Test: `packages/auth/tests/cross-runtime-error-parity.test.ts` (TBD V1).

### Tenant boundary
- **Given** a user with memberships in workspaces A and B, **when** their token's claim says `workspaceId=A`, **then** `requireWorkspaceMember` accepts on A and rejects on B. Coverage: integration. Test: `packages/auth/tests/active-workspace-scoped.test.ts` (TBD V1).
- **Given** a workspace switch via `auth.api.switchWorkspace`, **when** the new token is issued, **then** the prior token's `workspaceId` claim is no longer accepted (or is rotated) within a configured grace window. Coverage: integration. Test: `packages/auth/tests/workspace-switch-rotates-token.test.ts` (TBD V1).

### Role enforcement
- **Given** any of the four roles (`owner`/`admin`/`member`/`viewer`), **when** `requireRole(min)` is called, **then** the role hierarchy is enforced: `viewer < member < admin < owner`. Coverage: integration. Test: `packages/auth/tests/role-hierarchy.test.ts` (TBD V1).
- **Given** a `viewer` role, **when** a write operation is attempted, **then** the request returns 403. Coverage: integration. Test: `packages/auth/tests/viewer-cannot-write.test.ts` (TBD V1).

### Invite flow
- **Given** a workspace owner invites an email, **when** the invitee accepts, **then** a `Membership` row is created with the specified role and the activity is audited. Coverage: integration. Test: `packages/auth/tests/invite-flow.test.ts` (TBD V1).
- **Given** an invite, **when** the configured TTL elapses without acceptance, **then** the invite expires. Coverage: integration. Test: `packages/auth/tests/invite-expires.test.ts` (TBD V1).

### Cross-link
- ADR: [`docs/decisions/0012-multi-tenancy-workspace-as-tenant.md`](../../docs/decisions/0012-multi-tenancy-workspace-as-tenant.md).
- Architecture: [`docs/architecture/security.md`](../../docs/architecture/security.md).
