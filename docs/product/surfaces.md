# Core Product Surfaces

The user-visible surfaces that make Clearbolt useful. Listing feedback / personalization is split out to [feedback-personalization.md](feedback-personalization.md) given its prominence.

## Workspaces, Users, and Teams

Clearbolt is multi-tenant from V0, even if early users are solo. Get the boundaries right so V2 collaboration is additive, not a rewrite. ADR: [../decisions/0012-multi-tenancy-workspace-as-tenant.md](../decisions/0012-multi-tenancy-workspace-as-tenant.md).

Concepts:

- **Workspace**: the unit of isolation for deals, saved searches, finds, feedback, financial profile, outreach, and notes. A workspace can have one or many users.
- **User**: an authenticated individual account. Can belong to multiple workspaces (e.g. an analyst supporting multiple searchers).
- **Membership**: the link between a user and a workspace, with a role.
- **Roles** (initial set): `owner`, `admin`, `member`, `viewer`. Tighter scopes (e.g. "outreach only") can be added later.
- **Invites**: email-based invitations that materialize a pending membership.
- **Workspace types** (later): solo searcher, search-fund team, holdco, advisor multi-client.

Sharing rules:

- All deal/search/outreach/financial data lives under a workspace.
- The shared listing cache lives outside any workspace and is read-only to workspaces.
- Cross-workspace sharing must be explicit and audit-logged (e.g. shared comps in V3).

`TODO:` Define role permission matrix, invite expiration, SSO posture, and audit policy for membership changes.

## Onboarding Flow

The first 10 minutes determine whether a searcher comes back. Aim for:

1. Sign in and create or join a workspace.
2. Optional: paste 1-3 marketplace search URLs to seed saved searches.
3. Optional: short market-definition prompt (industry, geography, deal size).
4. Optional: rough buyer capacity (equity, leverage comfort, SBA y/n) to enable affordability filter.
5. Land in the deal explorer with first-run results from the saved search and a guided "like / dislike / save / pass" pass.

Treat each step as skippable and progressively enhance results as the searcher fills in more.

`TODO:` Decide whether onboarding is wizard-style or in-context nudges in the workspace.

## Searcher Workspace

The main workspace should help a searcher answer:

- What deals match my thesis?
- What changed since I last checked?
- Which listings are duplicates or syndicated versions of the same deal?
- Which broker or source should I contact?
- Which businesses should move into outreach, diligence, or pass?
- Which recommendations are improving based on what I liked, disliked, saved, or passed?

Expected concepts: thesis, saved criteria, saved searches, watchlists, likes/dislikes, pipeline stages, notes, tags, alerts, and source provenance.

## Buyer Financial Profile

Clearbolt should eventually let searchers enter private financial information so deal discovery can rank businesses by practical purchase feasibility, not just listing filters.

Potential inputs:

- Available personal equity and liquidity.
- Investor/backer commitments.
- Debt appetite and preferred lending path.
- SBA eligibility assumptions.
- Target down payment, leverage, DSCR, and cash-flow comfort.
- Seller financing expectations.
- Geographic and industry constraints that affect financing.

The financial profile is sensitive workspace data. It should be used to produce explainable ranking signals, not exposed to brokers, sellers, or service providers without explicit user action.

`TODO:` Define financial-profile schema, privacy boundaries, and whether Clearbolt provides calculations only or connects to lending/prequalification workflows.

## Market Definition

Clearbolt should help a buyer define the market they are searching in, then turn that definition into sourcing, ranking, and outreach criteria.

Market definition may include:

- Industry and sub-industry boundaries.
- Geography and service radius.
- Customer type, business model, recurring revenue, route density, regulatory constraints, or other thesis-specific traits.
- Target size range: revenue, EBITDA/SDE, cash flow, employee count, locations, asking price.
- Positive screens: durable demand, fragmented market, succession-driven sellers, margin profile, low capex, defensibility.
- Negative screens: customer concentration, licensing barriers, cyclicality, working-capital intensity, owner dependence, platform risk.
- Comparable businesses, example listings, and excluded examples.

The output should be usable both by humans and systems: a readable thesis document plus structured criteria for search, ranking, dedup, and outreach.

`TODO:` Define `MarketDefinition`, `MarketCriterion`, and `NegativeScreen` schemas.

## Deal Ranking and Purchase Fit

Search results should eventually be ranked by both **thesis fit** and **ability to purchase**.

Ranking signals may include:

- Match to target geography, industry, deal size, revenue, cash flow, and owner involvement.
- Estimated equity required under financing scenarios.
- SBA or conventional lending fit.
- Debt service coverage sensitivity.
- Seller financing availability.
- Downside/risk flags from listing text and business type.
- User history: liked, disliked, saved, passed, contacted, or advanced similar deals.
- Workspace-level preference learning from repeated positive/negative feedback.

Rankings must be explainable. A searcher should be able to see why a deal is "high fit but likely too large" or "lower revenue but financeable with seller note."

## Quality of Deal

Clearbolt should provide a quality-of-deal view that separates "interesting" from "actionable" and "financeable" from "good."

Potential dimensions:

- **Source quality**: direct broker/source site, stale marketplace listing, duplicated listing, thin description, missing financials.
- **Financial quality**: revenue/cash-flow consistency, margin reasonableness, add-back risk, working-capital/capex flags, financing sensitivity.
- **Business quality**: recurring revenue, customer concentration, owner dependence, employee depth, market durability, operational complexity.
- **Process quality**: broker responsiveness, CIM availability, NDA path, seller financing, transition support, deal timeline.
- **Diligence gaps**: missing tax returns, QoE need, legal/regulatory issues, landlord/lease risks, customer/vendor concentration.

This should produce an explainable score and a diligence checklist, not a black-box investment recommendation.

`TODO:` Define `DealQualityScore` dimensions, confidence, and required evidence.

## Saved Searches

Saved searches represent repeatable sourcing criteria.

- **Marketplace URL saved search**: user pastes a search-results URL from BizBuySell, BizQuest, BusinessesForSale, etc. The adapter parses it into structured parameters and schedules recurring checks.
- **Criteria saved search**: user defines geography, industry, price, cash flow, revenue, owner financing, or other filters directly in Clearbolt.
- **Off-market saved search**: user imports or defines a target universe, then Clearbolt tracks enrichment and outreach status.

`TODO:` Define the versioned `SavedSearchParams` schema and how marketplace-specific filters map into common criteria.

## Inbound Channels

Searchers receive deals through more than just searches. Capture inbound paths so nothing falls into a personal inbox black hole.

Inbound paths to support (V1 -> V2):

- **Email forwarding**: per-workspace forwarding address. Forwarded broker emails, newsletters, or referrals create source records and try to match a canonical deal.
- **Document uploads**: drag a CIM, financials, or teaser into a deal/workspace; parse into structured fields with provenance.
- **Manual deal entry**: quick form to add a business with whatever fields are known.
- **Browser extension** (V2): one-click capture from a marketplace, broker page, or AI tool conversation. See [../../apps/extension/agents.md](../../apps/extension/agents.md).
- **Newsletter ingestion** (later): subscribe a workspace inbox to ETA newsletters, parse listings.
- **API ingestion** (later): partners or scripts push deals into a workspace.

All inbound items should follow the same canonical/dedup pipeline as scraped results.

`TODO:` Decide email infrastructure (SES, Postmark, Mailgun, etc.), forwarding-address format, and inbound document parsing stack.

## Documents and Diligence

Deals accumulate documents (CIMs, tax returns, P&Ls, leases, customer lists). The product should have a place for them, even before full diligence workflows.

Initial scope:

- Per-deal **document store** with file metadata, type, source (uploaded, emailed in, broker-provided), and access scope.
- Optional **document parsing** for common artifacts (CIM text extraction, PDF P&L tables) with provenance back to the canonical deal.
- **NDA tracking**: status (none / requested / signed), signed date, expiry, broker/firm.
- **Diligence checklist** generated from `DealQualityScore` gaps; can be edited per workspace.
- **Notes** on each document with mentions of contacts/tasks.

Later (V3+): a richer **deal data room** with multi-party access, watermarking, and audit trail.

`TODO:` Decide whether documents live in R2 alongside source evidence with separate access policy, or in a dedicated documents bucket with stricter PII handling.

## Comps and Valuation

A deal isn't really evaluated until it has a comp story. Build the comps layer alongside ranking.

Initial scope:

- **Asking-multiple comps**: distribution of asking-price-to-cash-flow and asking-price-to-EBITDA by industry, geography, and size band, derived from observed listings.
- **Listing-vs-comps**: per-deal view showing where this listing sits relative to comparable on-market deals.
- **User-curated comps**: searcher can mark deals as "comparable" and exclude others.
- **Sold/closed signals** (when available): observed price drops, withdrawals, "sold" markers; treat as weak signals, not transaction comps.

Later (V3+):

- **Transaction comps** from third-party data (when licensed).
- **Industry valuation norms** as research artifacts the user can annotate.

`TODO:` Define `Comp`, `CompSet`, and how comps integrate into `DealQualityScore` and ranking.

## Notifications and Digests

Searchers should not have to log in to know if anything happened.

Channels:

- **Email digest** (default): daily or weekly batched updates per workspace.
- **In-app inbox**: persistent notification list with read/unread state.
- **Per-saved-search alerts**: immediate vs batched, with quiet hours.
- **Push / SMS** (later): opt-in for high-signal events (e.g. price drop on a watched deal).

Event types worth surfacing:

- New listings matching a saved search.
- Material changes on watched deals (price drop, status change, new financials).
- Outreach replies, bounces, or scheduled follow-ups due.
- Adapter health issues affecting a saved search (so the user knows results are stale).
- Diligence task reminders.

`TODO:` Define `Notification`, `NotificationPreference`, throttling rules, quiet hours, and per-event opt-in defaults.

## Off-Market Lead Management

Clearbolt should eventually act as the searcher's off-market lead management system.

Expected capabilities:

- Build target lists from uploads, research, enrichment providers, referrals, and manually entered businesses.
- Maintain business profiles: website, location, industry, size signals, ownership notes, estimated revenue/employee bands, source history, and why the target matches the thesis.
- Maintain contact profiles: owner/operator, broker, intermediary, executive, email, phone, LinkedIn, role, confidence, and source.
- Track email and phone outreach: planned sequences, manual tasks, call notes, replies, bounces, opt-outs, and follow-up dates.
- Keep outreach state separate from canonical business identity so each searcher/workspace can have its own relationship history.

`TODO:` Decide whether outreach is native in Clearbolt, integrated with external CRMs/email tools, or both.

## Provider and Partner Surfaces (Roadmap)

Clearbolt may eventually include sections for ecosystem participants who serve ETA buyers. Treat this as roadmap, not the initial product center of gravity:

- **Brokers**: listing distribution, buyer qualification, buyer interest, and inbound lead quality.
- **Bankers/lenders**: qualified searcher and deal leads based on financing fit.
- **Lawyers**: transaction counsel leads around LOI, diligence, and closing.
- **CPAs**: accounting diligence, tax review, and post-close support.
- **QoE providers**: quality-of-earnings and financial diligence leads.

This should be designed carefully. Provider lead generation must not compromise searcher trust. Searcher financials, pipeline activity, and off-market targets are private unless the searcher intentionally requests an introduction, quote, financing review, or referral.

`TODO:` Define provider profiles, lead-routing consent, monetization model, and conflict-of-interest policy.

## Deal-Team Shopping (Roadmap)

Clearbolt should eventually help buyers assemble a deal team for a specific thesis, deal, or stage. This should come after the core searcher workspace, saved searches, deduplication, buyer-fit ranking, quality-of-deal, and off-market lead management are useful.

Deal-team shopping may include:

- Broker relationship mapping and broker introductions.
- Banker/lender matching based on deal size, SBA/conventional fit, geography, industry, and buyer profile.
- Lawyer matching for LOI, acquisition agreement, financing, employment, real estate, and regulatory needs.
- CPA/tax advisor matching for tax diligence, structure, and post-close accounting.
- QoE provider matching for financial diligence depth, industry fit, and timing.

The buyer should be able to request introductions or quotes with explicit control over what information is shared.

## Deal Pipeline

A deal should move through product states independent of where it came from.

Suggested early states:

- `new`
- `watching`
- `researching`
- `queued_for_outreach`
- `contacted`
- `responded`
- `reviewing`
- `diligence`
- `passed`
- `archived`

`TODO:` Confirm whether pipeline state belongs to the user/searcher workspace, not the canonical global listing.

## Validation criteria

Each surface has at least one falsifiable assertion. Surfaces marked V2+/V3+ defer their validation to the corresponding phase doc.

### Workspaces, users, teams (V1)
- **Given** any deal/search/outreach/financial row, **when** read, **then** it has a `workspaceId`. Coverage: schema. Test: `packages/core/tests/all-private-rows-have-workspace.test.ts` (TBD V1).
- **Given** any cross-workspace sharing event (V3+), **when** it occurs, **then** an `AuditEvent` is recorded (see [../operations/audit-activity.md](../operations/audit-activity.md)).

### Onboarding flow (V1)
- **Given** a new user, **when** they complete the onboarding skip-everything path, **then** they land in the deal explorer with empty state and a clear next-step nudge. Coverage: integration. Test: `apps/web/tests/onboarding-skip-everything.test.ts` (TBD V1).
- **Given** a new user, **when** they paste a marketplace search URL, **then** a saved search is created and first results render within 2 minutes (P95). Coverage: integration. Test: `apps/web/tests/onboarding-paste-url.test.ts` (TBD V1).

### Searcher workspace (V1)
- **Given** a workspace with at least one saved search, **when** the workspace home renders, **then** it answers (a) "what deals match my thesis", (b) "what changed since last check", (c) "what duplicates exist". Coverage: integration. Test: `apps/web/tests/workspace-home-three-questions.test.ts` (TBD V1).

### Buyer financial profile (V2)
- **Given** a workspace with a stored financial profile, **when** any non-workspace-member user attempts to read it, **then** the request is rejected (403). Coverage: integration. Test: `services/api/tests/financial-profile-tenant-isolation.test.ts` (TBD V2).
- **Given** a workspace with a stored financial profile, **when** the deal explorer renders, **then** affordability ranking is applied with a visible explanation. Coverage: integration. Test: `apps/web/tests/affordability-ranking.test.ts` (TBD V2).

### Market definition (V2)
- **Given** a workspace with a written market definition, **when** the saved-search runs, **then** market criteria filter candidates and negative screens exclude candidates. Coverage: integration. Test: `apps/web/tests/market-definition-applied.test.ts` (TBD V2).

### Deal ranking and purchase fit (V2)
- **Given** any ranked deal in the explorer, **when** the user clicks "why this rank", **then** the explanation cites the specific signals (geography match, deal size band, financing fit, user history). Coverage: integration. Test: `apps/web/tests/ranking-explainable.test.ts` (TBD V2).

### Quality of deal (V2)
- **Given** any deal with sufficient evidence, **when** rendered, **then** the four quality dimensions (source, financial, business, process) are shown with a confidence band, not a single black-box number. Coverage: integration. Test: `apps/web/tests/deal-quality-explainable.test.ts` (TBD V2).

### Saved searches (V0/V1)
- **Given** a marketplace URL pasted into a saved search, **when** the adapter parses it, **then** the structured `SavedSearchParams` round-trips back to a URL that returns the same first page of results. Coverage: integration + golden-set. Test: `packages/scraper/tests/saved-search-roundtrip.test.ts` (TBD V0/V1).
- **Given** a saved search with a recurring schedule, **when** a scheduled run completes, **then** new/changed listings appear in the workspace within 5 minutes (P95). Coverage: integration. Test: `apps/web/tests/saved-search-cadence.test.ts` (TBD V1).

### Inbound channels (V1 → V2)
- **Given** the V1 email-forwarding channel, **when** a forwarded email is received at a workspace's address, **then** a source record is created and a canonical-deal match is attempted. Coverage: integration. Test: `services/inbound-email/tests/forward-creates-source.test.ts` (TBD V1).
- **Given** a V1 document upload, **when** uploaded, **then** the file is stored in `EvidenceStore` with workspace-scoped ACL and parsed into structured fields with provenance. Coverage: integration. Test: `services/documents/tests/upload-with-provenance.test.ts` (TBD V1).

### Documents and diligence (V2)
- **Given** any document, **when** read by any non-workspace-member user, **then** the request is rejected (403). Coverage: integration. Test: `services/documents/tests/tenant-isolation.test.ts` (TBD V2).

### Comps and valuation (V2)
- **Given** a deal with at least 5 comparable on-market deals, **when** rendered, **then** the listing-vs-comps view shows the deal's position against the comp distribution with the comp set listed. Coverage: integration. Test: `apps/web/tests/comps-explainable.test.ts` (TBD V2).

### Notifications and digests (V1)
- **Given** a workspace with email-digest enabled, **when** the daily digest runs, **then** the email contains: new matches, watched-deal changes, outreach updates (V2+), and adapter-health warnings. Coverage: integration. Test: `services/notifications/tests/digest-coverage.test.ts` (TBD V1).
- **Given** a workspace with quiet hours configured, **when** an event occurs during quiet hours, **then** the notification is batched until quiet hours end. Coverage: integration. Test: `services/notifications/tests/quiet-hours.test.ts` (TBD V1).

### Off-market lead management (V2)
- **Given** a workspace's off-market target list, **when** the user takes an outreach action, **then** the action produces a `ContactTouch` with channel, status, and follow-up date. Coverage: integration. Test: `services/outreach/tests/touch-recorded.test.ts` (TBD V2).
- **Given** the same business shared across two workspaces, **when** workspace A logs an outreach event, **then** workspace B sees no relationship history for that business. Coverage: integration. Test: `apps/web/tests/tenant-isolation/outreach-isolated.test.ts` (TBD V2).

### Provider and partner surfaces (V3+)
- See [../phases/V3-plus.md](../phases/V3-plus.md) validation criteria. Hard gate: provider-facing UI must not ship until searcher consent + audit + privacy reviews pass.

### Deal pipeline (V1)
- **Given** any deal, **when** moved between pipeline states, **then** the state change is workspace-scoped (not visible to other workspaces) and an `AuditEvent` is written. Coverage: integration. Test: `apps/web/tests/pipeline-state-isolated.test.ts` (TBD V1).

### Cross-link
- Listing feedback / personalization: see [feedback-personalization.md](feedback-personalization.md) validation criteria.
- Tenant isolation: see [../architecture/security.md](../architecture/security.md) validation criteria.
