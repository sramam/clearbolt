# V3+ — Roadmap surfaces

These surfaces are explicitly post-V2 and will be sequenced based on user demand and trust. None of them block the V0 -> V1 -> V2 path.

## Provider profiles and deal-team shopping

- Broker, banker/lender, lawyer, CPA, QoE provider profiles.
- Specialty matching (geography, deal size, industry, transaction type, SBA experience, QoE focus).
- Buyer-consented introduction / quote / financing review / diligence request workflows.
- Audit trail for shared fields and consent grants/revocations.

Designed carefully: provider lead generation must not compromise searcher trust. Searcher financials, pipeline activity, and off-market targets stay private unless the searcher intentionally requests an introduction.

## Lender prequalification integrations

- SBA lender prequalification.
- Conventional lender capacity checks.
- Indicative financing fit pulled into ranking.

## Public API and webhooks

- Scoped tokens per workspace.
- Read-first; mutations gated.
- Webhook subscriptions on events (new match, price drop, outreach reply, pipeline change).
- Standard event payloads enabling Zapier / Make / n8n integrations.

## CRM integrations

- HubSpot, Salesforce, Affinity for searchers using external CRMs.
- Bidirectional sync for deals, contacts, outreach.

## Spreadsheet round-trip

- CSV import/export.
- Google Sheets bidirectional mirror.

## Cross-workspace shared comps/research

- Privacy-preserving aggregate comps.
- Opt-in shared research artifacts.

## Multi-region / currency support

- Beyond US.
- ISO 4217 currency code on every money field already in V1; surfacing follows.

## Native mobile

- Deferred until web usage justifies it.

`TODO:` Convert this into ordered tracked work once V2 is shipped.

## Validation criteria

V3+ surfaces are roadmap-staged; concrete acceptance is added when each surface is scoped into a real release. Until then, criteria are framed as **gating conditions** that must be satisfied before each surface ships.

### Provider profiles and deal-team shopping
- **Given** a searcher requests an introduction to a broker via the platform, **when** the consent flow runs, **then** only fields the searcher explicitly approved are shared and the audit log records what was shared, when, and to whom. Coverage: integration. Test: `services/providers/tests/consent-flow.test.ts` (TBD V3).
- **Given** a workspace's financial profile, pipeline, or off-market targets, **when** any provider lookup runs, **then** these fields are not shared with any provider absent explicit per-deal opt-in. Coverage: property test over the provider data flow. Test: `services/providers/tests/financial-fields-never-leak.property.test.ts` (TBD V3).

### Lender prequalification
- **Given** an SBA lender integration, **when** the searcher submits a prequal request, **then** the request payload includes only the searcher-approved fields and the response is stored in the workspace's private namespace. Coverage: integration. Test: `services/providers/tests/sba-prequal.test.ts` (TBD V3).

### Public API and webhooks
- **Given** an API token scoped to one workspace, **when** any request is made, **then** the response set is provably restricted to that workspace's resources. Coverage: integration. Test: `services/api/tests/scope-enforcement.test.ts` (TBD V3).
- **Given** a webhook subscription on `deal.price_changed`, **when** a price change occurs, **then** the webhook fires within 60 seconds with a signed payload and at-least-once delivery. Coverage: integration. Test: `services/webhooks/tests/delivery-and-signature.test.ts` (TBD V3).

### CRM integrations
- **Given** a HubSpot/Salesforce/Affinity sync configured, **when** a deal is updated in either system, **then** the change reconciles within 5 minutes and conflicts surface in the workspace UI for human resolution. Coverage: integration. Test: `services/crm-sync/tests/bidirectional-reconcile.test.ts` (TBD V3).

### Cross-workspace shared comps/research
- **Given** an opt-in workspace, **when** comps are aggregated across workspaces, **then** no individual workspace can be identified from the aggregated comps (k-anonymity ≥ 5). Coverage: property test. Test: `services/aggregates/tests/k-anonymity.property.test.ts` (TBD V3).

### Multi-region / currency
- **Given** any money field in the V1+ codebase, **when** read, **then** it carries an ISO 4217 currency code. Coverage: type-level + lint. Test: `packages/core/tests/money-field-iso4217.test.ts` (TBD whenever multi-currency lands).

### General gating
- No V3+ surface ships without its own dedicated `docs/phases/<surface>.md` doc that itself satisfies principle 5 (full validation criteria, not the high-level gating above).
