# Product Principles

Product-side principles (the user-visible product shape). Architectural principles live in [../architecture/principles.md](../architecture/principles.md).

1. **Searcher workflow first** — Scraping is a means to build deal flow. Features should map to the searcher's real process: criteria, saved searches, watchlists, outreach, notes, pipeline stages, and diligence.
2. **Canonical company/deal graph** — Multiple URLs may describe the same opportunity. Store sources separately, then resolve them into canonical deal and business records with provenance.
3. **On-market and off-market share a model** — Marketplace listings, broker listings, uploads, and outbound targets should converge into the same normalized objects where possible.
4. **Buyer capacity matters** — Search should rank opportunities by the user's actual ability to pursue and purchase: available equity, debt assumptions, SBA fit, seller financing, investor backing, geography, thesis, and risk tolerance.
5. **Shared cache, private workspaces** — Individual business listings and source-derived canonical records should live in a shared cache for better search quality and deduplication. User-specific searches, finds, likes/dislikes, notes, pipeline state, financial profiles, and outreach must stay compartmentalized by workspace.
6. **Preference feedback improves ranking** — Likes, dislikes, saves, passes, and advances are searcher-specific signals. Use them to personalize that workspace's search results without mutating global listing quality or leaking preferences across users.
7. **Market definition is a product artifact** — The buyer's target market should become structured criteria and a living document: industry boundaries, geography, business model, size, fragmentation, risks, acquisition rationale, and negative screens.
8. **Quality of deal is separate from availability** — A listing can be available and financeable but still be a bad deal. Track source quality, financial quality, business durability, seller/broker quality, and diligence gaps.
9. **Evidence over guesses** — Preserve source text, URLs, timestamps, and extraction confidence. Use AI to assist extraction and matching, not to invent facts.
10. **Incremental enrichment** — A sparse record is still useful if it can be enriched over time through broker crawling, website discovery, contact finding, classification, and user input.
11. **Outreach is part of sourcing** — Off-market lead management should include contacts, email/phone outreach, touch history, next actions, and response state. Do not model off-market as a static spreadsheet import.
12. **Ecosystem participants are roadmap customers** — Brokers, bankers, lawyers, CPAs, and QoE providers may eventually receive qualified leads or workflow surfaces. This is not an MVP requirement. Keep their data and incentives separate from the searcher's private workspace.
13. **Composable ingestion** — Add new sites and source types through adapters. Avoid one-off scraping logic embedded in UI or workflow code.

## Mobile and responsive

Searchers triage deals on phones between meetings. V1 web should be **responsive** with attention to:

- Deal explorer with quick like/dislike/save/pass interactions.
- Deal detail view that's readable on narrow screens.
- Notification deep links that open the right deal.
- Outreach and notes capture on mobile (eventually).

A native mobile app is deferred until usage justifies it.

## Validation criteria

Product principles are heuristics, but each one should be testable through user-visible behavior. Where a principle has a corresponding architectural mechanism, the test lives in the relevant package's conformance suite.

### Per-principle validation
- **#1 Searcher workflow first** — heuristic. **Given** any V1 feature, **when** the PR is reviewed, **then** the description names the searcher step it serves. Coverage: PR review checklist.
- **#2 Canonical company/deal graph** — falsifiable. **Given** any deal in the canonical graph, **when** read, **then** at least one source URL is recorded with `firstSeenAt` and `lastSeenAt`. Coverage: integration. Test: `packages/core/tests/canonical-deal-has-provenance.test.ts` (TBD V0/V1).
- **#3 On-market and off-market share a model** — falsifiable. **Given** an off-market upload and an on-market scrape of the same business, **when** dedup runs, **then** they merge to the same canonical record. Coverage: golden-set. Test: `packages/dedup/tests/cross-channel-merge.test.ts` (TBD V1).
- **#4 Buyer capacity matters** — falsifiable. **Given** a workspace with a financial profile, **when** the deal explorer renders, **then** at least one ranking signal references the financial profile (and the explanation is shown). Coverage: integration. Test: `apps/web/tests/financial-profile-ranking-signal.test.ts` (TBD V2).
- **#5 Shared cache, private workspaces** — hard rule (cross-tenant test suite, must be 100%). Test: `apps/web/tests/tenant-isolation/*.test.ts` (TBD V1).
- **#6 Preference feedback improves ranking** — falsifiable. **Given** a workspace with ≥ 50 like/dislike actions, **when** A/B compared against a workspace-blind baseline, **then** liked-deal precision improves by a measurable margin. Coverage: golden-set + A/B (V2).
- **#7 Market definition is a product artifact** — falsifiable. **Given** a workspace with a written market definition, **when** the deal explorer renders, **then** the market criteria are part of the candidate filter (not just narrative). Coverage: integration. Test: `apps/web/tests/market-definition-filters.test.ts` (TBD V2).
- **#8 Quality of deal is separate from availability** — falsifiable. **Given** any deal record, **when** read, **then** `availabilityScore` and `dealQualityScore` are stored as separate fields. Coverage: schema. Test: `packages/core/tests/schema-separates-availability-quality.test.ts` (TBD V2).
- **#9 Evidence over guesses** — hard rule. See [data-model.md](../architecture/data-model.md) and `apps/web/tests/no-claim-without-provenance.test.ts`.
- **#10 Incremental enrichment** — falsifiable. **Given** a sparse business record, **when** an enrichment pass runs, **then** at least one field is added or refined; provenance traceable. Coverage: integration. Test: `services/enrichment/tests/incremental-fill.test.ts` (TBD V2).
- **#11 Outreach is part of sourcing** — falsifiable (V2+). **Given** the V2 outreach surface, **when** an outreach action is taken, **then** it produces a `ContactTouch` with sequence step, channel, status, and follow-up date. Coverage: integration. Test: `services/outreach/tests/touch-recorded.test.ts` (TBD V2).
- **#12 Ecosystem participants are roadmap customers** — guardrail. **Given** any V0/V1/V2 surface, **when** reviewed, **then** no provider-facing UI ships before searcher-side trust gates from [../phases/V3-plus.md](../phases/V3-plus.md) pass. Coverage: roadmap review.
- **#13 Composable ingestion** — falsifiable. **Given** a new source-site adapter, **when** added, **then** no UI or workflow code is changed (only an adapter package and a registry entry). Coverage: PR review checklist + lint over `apps/web/` for adapter-name strings (TBD V1).

### Mobile / responsive
- **Given** the V1 web app, **when** measured against responsive breakpoints (≥ 320px width), **then** the deal explorer, deal detail, and notification deep-links render usably without horizontal scrolling. Coverage: integration. Test: `apps/web/tests/responsive-breakpoints.test.ts` (TBD V1).
