# Audit log and activity feed

Once a workspace can have multiple users (V2) and provider sharing exists (V3+), an audit log becomes essential.

## Track at minimum

- Membership and role changes.
- Buyer financial profile changes.
- Outreach sends and replies.
- Provider-sharing events and consent grants/revocations (V3+).
- Saved-search creation/deletion and run triggers.
- Pipeline state changes per deal.
- Document uploads and access events.
- Capture saves and deletions.
- Wiki page user-edits (vs maintainer-edits, which are tracked separately).
- Data exports and deletions.

## Surfaces

- **In-workspace activity feed**: human-friendly stream of recent events (member-visible).
- **Admin/owner audit view**: full structured log with filters, export.

## Schema

`AuditEvent` row in [data-model.md](../architecture/data-model.md).

```
AuditEvent
  id, workspaceId, actorUserId,
  category, action, target, payload, createdAt
```

## Retention

`TODO:` Define retention policy. Likely 1 year visible in UI, 7 years cold-stored for compliance, with deletion-on-request honored within 30 days.

## Exportability

Workspace owners can export the full audit log as JSON or CSV at any time.

## Validation criteria

The audit log is the system of record for "who changed what." Its validation criteria are about coverage (every important action is logged) and integrity (logged events cannot be silently mutated).

### Functional
- **Given** any of the action categories listed above, **when** the action is performed by a user, **then** an `AuditEvent` row is written within the same transaction (no fire-and-forget). Coverage: integration. Test: `services/api/tests/audit-write-in-transaction.test.ts` (TBD V2).
- **Given** any `AuditEvent`, **when** read, **then** `workspaceId`, `actorUserId`, `category`, `action`, `target`, `payload`, `createdAt` are all populated. Coverage: schema validation. Test: `services/api/tests/audit-event-schema.test.ts` (TBD V2).
- **Given** any provider-sharing event (V3+), **when** it occurs, **then** an `AuditEvent` is written *and* a separate consent-grant row is written referencing the audit event. Coverage: integration. Test: `services/api/tests/provider-sharing-audit.test.ts` (TBD V3).
- **Given** an `AuditEvent` row, **when** any process tries to mutate it after creation, **then** the write is rejected (rows are append-only at the data layer). Coverage: integration. Test: `services/api/tests/audit-event-immutable.test.ts` (TBD V2).

### Surfaces
- **Given** a workspace member, **when** they open the activity feed, **then** they see a human-friendly stream of recent events scoped to the workspace. Coverage: integration. Test: `apps/web/tests/activity-feed.test.ts` (TBD V2).
- **Given** a workspace owner, **when** they open the admin audit view, **then** they see filterable structured logs and an export button. Coverage: integration. Test: `apps/web/tests/admin-audit-view.test.ts` (TBD V2).
- **Given** a workspace owner, **when** they request a JSON or CSV export, **then** the export contains every audit event for the workspace in the chosen time window. Coverage: integration. Test: `services/api/tests/audit-export.test.ts` (TBD V2).

### Privacy / retention
- **Given** any user, **when** they request deletion under the privacy policy, **then** their `actorUserId` references in audit events are pseudonymized within 30 days (the events themselves remain for compliance). Coverage: integration. Test: `services/api/tests/audit-pseudonymization.test.ts` (TBD V2).
- **Given** the configured retention policy, **when** an audit event is older than the cold-storage threshold, **then** it is moved to cold storage and removed from the hot UI view. Coverage: integration. Test: `services/api/tests/audit-retention.test.ts` (TBD V2.5).

### Cross-link
- Schema definition: [data-model.md](../architecture/data-model.md) `AuditEvent`.
- Tenant isolation: enforced via the same workspace-scoped data-access layer as all other rows; verified by the cross-tenant test suite.
