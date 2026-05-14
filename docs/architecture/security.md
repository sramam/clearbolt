# Security and compliance

This product must be designed around sustainable, defensible data practices.

## Compliance baseline

- Respect robots.txt, site terms, rate limits, and applicable law.
- Do not bypass authentication, paywalls, or private systems.
- Do not credential-stuff or impersonate real users.
- Add rate limits, domain-level policies, and identifiable contact/user-agent policy where appropriate.
- Treat off-market data, contact data, and inferred business identity as sensitive.
- Treat buyer financial profiles as highly sensitive private data with explicit sharing controls.
- Treat likes, dislikes, saved searches, and pipeline actions as private workspace behavior, not global listing facts.
- Treat outbound email/phone as regulated workflow: suppression lists, opt-outs, consent/legitimate-interest posture, deliverability, and jurisdiction-specific requirements must be designed before automation.
- Treat provider lead generation as opt-in referral workflow, not automatic resale of searcher activity or financial data.

`TODO:` Add legal review checklist, retention policy, and per-source compliance notes.

## Universal clipper guardrails

Captures are user-initiated and per-user. ADR: [../decisions/0004-extension-universal-user-capture.md](../decisions/0004-extension-universal-user-capture.md).

For private networks (Axial, etc.) the clipper is a personal-productivity tool, not a scraper:

- No background crawling.
- No pagination automation.
- No bulk import.
- No cross-user pooling of captures.
- No resale or republication of imported records.
- No model training on imported confidential content.
- No bypassing login, paywalls, rate limits, or technical controls.

## Security posture

Searchers are putting their thesis, financials, and outreach pipeline into Clearbolt. Earn that trust with explicit defaults.

Baseline:

- **Encryption in transit** everywhere; **encryption at rest** on databases, object storage, and backups (Neon and R2 both encrypt at rest by default).
- **Secrets** managed in a vault (Doppler / 1Password / SST); never plaintext-committed; rotated; never logged.
- **PII inventory**: documented list of PII fields and where they live (workspace data, contacts, outreach, financial profile).
- **Retention defaults** with workspace-level overrides; deletion-on-request honored.
- **Data export** for workspace owners.
- **Least-privilege access** for service-to-service calls; per-tenant scoping enforced at the data-access layer, not just the API edge.
- **Background workers** must respect workspace scoping and never cross tenants by accident.
- **Credentials reachable from agent code paths** must follow the "credentials in vault, not in sandbox" pattern (per managed-agent prior art).

## Multi-tenancy

ADR: [../decisions/0012-multi-tenancy-workspace-as-tenant.md](../decisions/0012-multi-tenancy-workspace-as-tenant.md).

- Workspaces are the tenant boundary.
- Every workspace-scoped table in Neon carries a `workspaceId` column with FK + index.
- Every R2 key for workspace-private data carries a workspace prefix: `workspaces/<workspaceId>/<rest>`.
- better-auth tokens carry `workspaceId` (the active workspace) in their claims. Validated identically by CF Worker and Fly Node runtimes.
- Cross-tenant fixtures in the test suite verify isolation.

## Roadmap

- SOC 2 trajectory if/when targeting funds, family offices, or enterprise.
- SSO/SAML for team accounts (V2).
- Per-workspace audit export.

`TODO:` Decide secrets manager, KMS, retention policy defaults, and SOC 2 timeline.

## Validation criteria

### Functional
- **Given** a request to any workspace-scoped resource, **when** the requestor's token's `workspaceId` claim does not match the resource's `workspaceId`, **then** the request is rejected. Coverage: integration. Test: `apps/web/tests/tenant-isolation/cross-workspace-rejected.test.ts` (TBD V1).
- **Given** any background worker (scraper, transcribe, agent runner, queue worker, capture worker), **when** it processes a workspace-scoped job, **then** it does so with an explicit workspace context that matches the job's payload `workspaceId`. Coverage: integration. Test: `services/<each>/tests/workspace-scope-respected.test.ts` (TBD V1).
- **Given** a token issued for workspace A, **when** the active workspace is switched to B, **then** the old token is invalidated within 60 seconds and a new token with the B claim is issued. Coverage: integration. Test: `packages/auth/tests/active-workspace-switch.test.ts` (TBD V1).

### Compliance
- **Given** any new ingestion target (marketplace, broker, off-market source), **when** it is added, **then** a per-source compliance note is filed describing robots.txt posture, ToS review, rate limit policy, and identifiable user-agent. Coverage: PR review (every adapter PR has a compliance checklist). Test: `scripts/lint-specs.mjs::adapter_has_compliance_note` (TBD V1).
- **Given** a `WorkspaceCapture` from a private deal network host (Axial, gated portals, NDA-bound), **when** any aggregation pipeline runs, **then** the capture is excluded from any cross-workspace artifact. Coverage: data-flow audit + integration. Test: `services/aggregates/tests/private-network-captures-excluded.test.ts` (TBD V2).
- **Given** any outbound email sent from the platform, **when** the recipient is on the workspace's suppression list, **then** the send is blocked and the attempt is logged. Coverage: integration. Test: `services/outreach/tests/suppression-respected.test.ts` (TBD V2).
- **Given** any outbound email, **when** the recipient's jurisdiction requires opt-in (CAN-SPAM, GDPR, CASL), **then** the consent gate is checked before send. Coverage: integration. Test: `services/outreach/tests/consent-gates-by-jurisdiction.test.ts` (TBD V2).

### Encryption / secrets
- **Given** any persistent connection (Neon, R2, third-party APIs), **when** it is established, **then** TLS 1.2+ is required (no plain HTTP, no TLS 1.0/1.1). Coverage: integration. Test: `services/<each>/tests/tls-required.test.ts` (TBD V1).
- **Given** any secret (API key, signing key, DB credential), **when** code is committed, **then** `git secrets` style scanning catches it. Coverage: pre-commit hook + CI. Test: `.github/workflows/secret-scan.yml` (TBD V1).
- **Given** any log line, **when** emitted, **then** it does not contain a credential value (per `Logger.redaction` test). Coverage: unit. Test: `packages/observability/tests/logger-redaction.test.ts`.

### Retention and DSR
- **Given** a workspace owner requests data export, **when** the job runs, **then** within 7 days the owner receives a downloadable archive of all workspace-scoped data (financial profile, captures, wiki, outreach, audit log, finds, feedback). Coverage: integration. Test: `services/dsr/tests/export-end-to-end.test.ts` (TBD V1.5).
- **Given** a CCPA/GDPR delete-by-userId request, **when** the job runs, **then** within 30 days all records for that userId are removed across MetadataStore, EvidenceStore, telemetry, and logs. Coverage: integration. Test: `services/dsr/tests/delete-end-to-end.test.ts` (TBD V1.5).
