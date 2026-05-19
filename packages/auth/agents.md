# `packages/auth`

> Runtime: **both** (target). Better-auth wrapper with Clearbolt naming and claim types. Same library should validate tokens on CF Workers and Fly Node once the split entrypoints land.

Wraps [better-auth](https://www.better-auth.com/) with Clearbolt-specific defaults: workspaces/orgs as tenant boundary, pluggable social providers, token shape that both runtimes validate identically. **Product “team”** = **workspace** (`workspaceId` in claims and DB).

ADR: [`docs/decisions/0012-multi-tenancy-workspace-as-tenant.md`](../../docs/decisions/0012-multi-tenancy-workspace-as-tenant.md). Pipeline projects + invites + user-scoped searches: [`docs/architecture/teams-projects-dealbox.md`](../../docs/architecture/teams-projects-dealbox.md).

## Implemented today (V1 scaffold)

- **`createClearboltAuth(prisma)`** — better-auth instance with:
  - `prismaAdapter` against [`packages/db`](../db/agents.md) `getPrisma()` client
  - **`organization`** plugin (workspaces; users may create orgs)
  - **`emailOTP`** plugin (magic-link style sign-in; Resend when `RESEND_API_KEY` is set, else console OTP in dev)
  - Optional **Google** / **GitHub** OAuth when client id + secret env vars are set
  - Requires `BETTER_AUTH_SECRET` (≥32 chars) and `BETTER_AUTH_URL` (default `http://localhost:3000`)
- **`getClearboltAuth()`** / **`isAuthConfigured()`** — lazy singleton for Node handlers ([`apps/web`](../web/agents.md) `/api/auth/[...all]`).
- **`@clearbolt/auth/client`** — React client helpers for the web sign-in UI.
- **Types:** `ClearboltClaims`, `WorkspaceRole`, `AuthError`.
- **`user-id` helpers:** `assertInternalUserId`, `isLikelyEmailUserId` (guardrails so product code never keys rows by email).

**Not yet exported:** `requireAuth`, `requireWorkspaceMember`, `requireRole` on `@clearbolt/auth/workers` and `@clearbolt/auth/node` (spec below; implement with shared session validation).

Schema merge: `pnpm --filter @clearbolt/auth auth:schema` writes better-auth models into `packages/db/prisma/schema.prisma` (review diff before migrate).

## Org structure (V1)

- **Workspace** = better-auth **organization** = tenant for data and storage prefixes ([`packages/storage`](../storage/agents.md)).
- **Membership** = org membership with role `owner` \| `admin` \| `member` \| `viewer`.
- **Active workspace** = `activeOrganizationId` on the session (JWT); switching org reissues the session.
- **Per-user rows** (saved market queries, dealbox disposition, private drafts) key off **`userId`** = better-auth **`User.id`** (internal string id). **Never** persist email as the owner key — email is only for login and invites.

## Token-claim shape (target)

```ts
interface ClearboltClaims {
  userId: string;
  workspaceId: string;          // currently active workspace (org id)
  workspaceRole: 'owner' | 'admin' | 'member' | 'viewer';
  scopes?: string[];            // for API tokens
  iat: number;
  exp: number;
}
```

The token is a better-auth session JWT plus our claim shape. Validation on either runtime should return the same `ClearboltClaims`.

## API surface (target)

```ts
// On CF Worker (planned):
import { requireAuth, requireWorkspaceMember } from '@clearbolt/auth/workers';
const claims = await requireWorkspaceMember(req, env);

// On Fly Node (planned):
import { requireAuth, requireWorkspaceMember } from '@clearbolt/auth/node';
const claims = await requireWorkspaceMember(req);
```

Today, apps use better-auth's handler and `get-session` (see [`apps/web`](../web/agents.md) middleware).

## Social providers

V1: Google, GitHub, email OTP (password table via better-auth `Account` when enabled). Env template: [`.env.example`](../../.env.example).

V2+: pluggable additional providers based on customer demand (Microsoft, Apple, SAML/OIDC for team accounts).

## Where it runs

- **CF Pages / Workers**: validates tokens for session-bound web routes and the `POST /api/captures` endpoint (planned).
- **Fly Node**: validates tokens for the write API and any agent runners that need workspace context.

## Schema

User, Session, Account, Organization, Member, Invitation, Verification — in [`packages/db`](../db/agents.md) `prisma/schema.prisma` (better-auth + Clearbolt pipeline tables). Workspace extension fields beyond org metadata land in app tables (`workspace_projects`, …).

## Phasing

- V0: not used (no auth in V0 CLI; optional `CLEARBOLT_DEV_USER_ID` bypass in web when better-auth env is absent).
- V1 (in progress): `createClearboltAuth`, web sign-in + middleware, org plugin; claim helpers and cross-runtime `require*` TBD.
- V2: SSO/SAML, finer-grained scopes (e.g. "outreach only").

## Validation criteria

### Types and errors (scaffold)
- **Given** this package, **when** `pnpm build` runs, **then** `ClearboltClaims`, `WorkspaceRole`, and `AuthError` compile and export from the package root. Coverage: smoke. Test: `packages/auth/tests/exports.test.ts`.

### User id guardrails
- **Given** a string that looks like an email, **when** `isLikelyEmailUserId` runs, **then** it returns true; internal ids do not match. Coverage: unit. Test: `packages/auth/tests/user-id.test.ts`.
- **Given** `assertInternalUserId` with an email-shaped id, **when** called, **then** it throws. Coverage: unit. Test: `packages/auth/tests/user-id.test.ts`.

### Email OTP (unit)
- **Given** OTP template inputs, **when** the template is rendered, **then** subject and body include the code and expiry hint. Coverage: unit. Test: `packages/auth/tests/otp-email-template.test.ts`.
- **Given** Resend is not configured, **when** `sendClearboltVerificationOtp` runs in dev, **then** it does not throw (console path). Coverage: unit. Test: `packages/auth/tests/send-verification-otp-email.test.ts`.

### Cross-runtime token validation (hard rule)
- **Given** a token issued by the auth provider, **when** validated on CF Workers via `@clearbolt/auth/workers` and on Fly Node via `@clearbolt/auth/node`, **then** both return identical `ClearboltClaims` (same `userId`, `workspaceId`, `workspaceRole`, `scopes`, `iat`, `exp`). Coverage: integration. Test: `packages/auth/tests/cross-runtime-token-validation.test.ts` (TBD V1).
- **Given** an invalid or expired token, **when** validated on either runtime, **then** the same `AuthError` subtype is thrown. Coverage: integration. Test: `packages/auth/tests/cross-runtime-error-parity.test.ts` (TBD V1).

### Tenant boundary
- **Given** a user with memberships in workspaces A and B, **when** their token's claim says `workspaceId=A`, **then** `requireWorkspaceMember` accepts on A and rejects on B. Coverage: integration. Test: `packages/auth/tests/active-workspace-scoped.test.ts` (TBD V1).
- **Given** a workspace switch via org switch API, **when** the new session is issued, **then** the prior session's active org is no longer used for scoped reads. Coverage: integration. Test: `packages/auth/tests/workspace-switch-rotates-token.test.ts` (TBD V1).

### Role enforcement
- **Given** any of the four roles (`owner`/`admin`/`member`/`viewer`), **when** `requireRole(min)` is called, **then** the role hierarchy is enforced: `viewer < member < admin < owner`. Coverage: integration. Test: `packages/auth/tests/role-hierarchy.test.ts` (TBD V1).
- **Given** a `viewer` role, **when** a write operation is attempted, **then** the request returns 403. Coverage: integration. Test: `packages/auth/tests/viewer-cannot-write.test.ts` (TBD V1).

### Invite flow
- **Given** a workspace owner invites an email, **when** the invitee accepts, **then** a `Membership` row is created with the specified role and the activity is audited. Coverage: integration. Test: `packages/auth/tests/invite-flow.test.ts` (TBD V1).
- **Given** an invite, **when** the configured TTL elapses without acceptance, **then** the invite expires. Coverage: integration. Test: `packages/auth/tests/invite-expires.test.ts` (TBD V1).

### Stable user id (not email)
- **Given** a user with `UserMarketQuery` or disposition rows keyed by `userId`, **when** they change their primary email in better-auth, **then** `userId` is unchanged and all user-scoped rows still attribute to the same account. Coverage: integration (contract unit test until better-auth wired). Test: `packages/auth/tests/email-change-preserves-user-scoped-rows.test.ts`.

### Cross-link
- ADR: [`docs/decisions/0012-multi-tenancy-workspace-as-tenant.md`](../../docs/decisions/0012-multi-tenancy-workspace-as-tenant.md).
- Architecture: [`docs/architecture/security.md`](../../docs/architecture/security.md), [`docs/architecture/teams-projects-dealbox.md`](../../docs/architecture/teams-projects-dealbox.md).
- Storage tenant rules: [`packages/storage/agents.md`](../storage/agents.md).
- Web integration: [`apps/web/agents.md`](../../apps/web/agents.md).
