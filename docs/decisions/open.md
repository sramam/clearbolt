# Open decisions

Resolved decisions live as ADRs (`0001` … `0016`). Items here are still in motion. Per principle 5 ([principles.md §5](../architecture/principles.md#5-specs-include-validation-criteria-negotiated-before-commit)), every open decision specifies what observation would resolve it — these double as the falsifiability criteria for "open" status.

| Topic | Notes | Resolved when |
|-------|-------|---------------|
| App framework | Next.js assumed for the web app. | First V1 web PR lands and CI is green; alternative (Remix / React Router 7) explicitly considered and rejected in commit message or follow-up ADR. |
| ORM/query layer V0 | Disk JSON in V0 CLI; **Prisma v7 landed** for cloud/hybrid dev (`packages/db`, JSONB metadata + pipeline + FTS). Full relational cutover to the [data-model sketch](../architecture/data-model.md) is incremental. | Neon `MetadataStore` conformance green in CI with `DATABASE_URL`; CF HTTP driver bound for edge reads; remaining entities migrated per feature ADR. |
| Dedup LLM routing | Interim: optional OpenRouter cheap chat (`OPENROUTER_API_KEY`, `CLEARBOLT_DEDUP_LLM_MODEL`, `CLEARBOLT_DEDUP_LLM_WEIGHT`) blended in `packages/dedup` `scorePairAsync`; **CI requires** `OPENROUTER_API_KEY` secret and runs live tests (`openrouter-dedup.live.test.ts`). | Same behavior behind `packages/ai` `ModelProvider` + AI Gateway with cost attribution; OpenRouter-only path removed or demoted to dev fallback. |
| Search engine | V0 in-memory filter without DB; **Postgres FTS partial** (`deal_search_index` + `packages/search` query prep). Quickwit deferred. | Full `SearchIndex` conformance suite + CF read path; Quickwit revisit if FTS p95 > 200ms at sustained volume. |
| Workspace personalization model | Feedback signals, decay rules, mute scopes, snooze policy. | V1 ranking work ships with documented decay function, mute scope semantics, and a documented golden-set of personalization fixtures passing. |
| Job queue | V0 in-memory + node-cron; V1+ pg-boss on Neon. CF Queues adapter as V2+ option. | pg-boss tables provisioned on Neon, conformance suite passes, V1 web app uses it for at least one async write path. |
| Auth and SSO | Better-auth via `packages/auth` for V1. SSO/SAML in V2. | V1 — `AuthProvider` conformance against better-auth passes for both runtimes. V2 — SSO/SAML providers added behind the same contract. |
| Hosting | Decided: hybrid CF Pages + CF Workers + Fly.io ([ADR 0010](0010-deployment-hybrid-cf-fly.md)). Specific Fly regions TBD. | Fly region pinned (likely `iad` for primary; secondaries based on user distribution); documented in `docs/operations/environments.md`. |
| CI/CD | GitHub Actions assumed. | First green V1 CI run on GitHub Actions; alternative considered and rejected in `docs/operations/environments.md` or follow-up ADR. |
| Secrets manager / KMS | TBD — Doppler vs SST vs 1Password. | V1 cutover requires secrets management; decision recorded as ADR 0017 (or similar) before V1 production deploy. |
| Backup and DR policy | Neon's automatic backups + R2 versioning enabled in prod. Quarterly restore test cadence to confirm. | First quarterly restore test passes end-to-end; runbook in `docs/operations/`. |
| Proxy/provider strategy | V0 direct default; **optional rotating proxy** via env + endpoints file (Decodo/residential documented in `.env.example`). | Vendor choice recorded as ADR when production Fly scraper runs sustained catalog at target block rate. |
| Off-market data sources | Beyond V1 (Google Maps, state license DBs, SOS, county data, SAM.gov, contractor DBs). | Per-source ADR for each as it ships; remains "open" until at least one off-market source is in V2. |
| Buyer financial profile schema | Drafted in [data-model.md](../architecture/data-model.md); finalize in V1 ranking work. | V1 ranking PR lands; schema documented and Prisma migration applied. |
| Financing assumptions/calculation policy | Whether Clearbolt provides calculations only or connects to lending/prequalification (regulated). | Legal review on regulatory exposure; recorded as ADR before V2 outreach work. |
| Lender/prequalification integrations | V3+ roadmap. | First lender integration enters scope (V3+ phase doc); revisited then. |
| Market definition harness | Skill specs documented in [harness.md](../architecture/harness.md); build in V1+. | `wiki-ingest` and market-definition skills land in V1; golden-set tests pass. |
| Quality-of-deal scoring dimensions | Drafted in [surfaces.md](../product/surfaces.md); finalize during V1 quality-of-deal work. | V1 ships explainable score; dimensions and weights documented; user feedback rate ≥ 10%. |
| Comps data model and sourcing | Drafted in [surfaces.md](../product/surfaces.md); V2 work. | V2 comps panel ships with at least one comp source connected. |
| Listing lifecycle/event schema | `DealEvent` shape in [data-model.md](../architecture/data-model.md); finalize event types in V1. | V1 ships with the V1 event types frozen and documented; new types added behind a versioning policy. |
| Geography taxonomy | Pick MSA/county/zip rules; ship in V1 normalization layer. | V1 normalization passes for top-50 MSAs; per-MSA bucketing used by Layer 3 cross-workspace aggregates. |
| Industry taxonomy | NAICS edition + internal categories; ship in V1 normalization layer. | NAICS edition pinned (likely 2022 latest); mapping table committed; bucketing used by Layer 3 aggregates. |
| Currency/region scope (V1) | US/USD default; design carries currency code on every money field. | V1 lands; lint asserts ISO 4217 on every money field per [V3+ validation criteria](../phases/V3-plus.md). |
| Team / project / dealbox model | Projects on a team; per-user dealbox + anti-dealbox; user-scoped market queries. | [teams-projects-dealbox.md](../architecture/teams-projects-dealbox.md) merged; **Prisma tables applied**; web/API enforce membership on all write paths. |
| Workspace roles and permissions | Initial set: `owner`, `admin`, `member`, `viewer`. | V2 ships with role matrix documented and `apps/web/tests/role-matrix.test.ts` passing for every role × resource combination. |
| Onboarding UX | Wizard vs in-context nudges. | V1 web app PR lands with one approach implemented and the other documented as the rejected alternative. |
| Inbound email infra | TBD — Postmark / SES / Mailgun. V1+. | V1 transactional email works (digest + auth); vendor recorded as ADR. |
| Document store and parsing | V2 work. | V2 documents panel ships with at least PDF P&L extraction working. |
| Notification channels and defaults | V1 ships email digest; full preference matrix in V2. | V2 ships with per-workspace notification preferences UI and at least 3 channels (email, in-app, webhook). |
| Cost budgets and attribution | AI Gateway gives the data; in-product reporting design in V1. | V1 admin UI shows per-workspace AI cost; soft cap enforces. |
| AI eval harness location | V2 work. Likely a `packages/evals` separate from `packages/agents`. | V2 ships with evals package, golden sets per task, and CI gate. |
| Adapter health/SLA surfacing | V1 work; UI placement TBD. | V1 admin UI shows per-adapter freshness and block rate. |
| Re-extraction/replay policy | Versioning + idempotency keys defined in [storage.md](../architecture/storage.md); operational tooling in V1. | V1 ships replay command (already prototyped in V0); operator runbook documented. |
| Audit log schema and retention | Schema drafted in [data-model.md](../architecture/data-model.md); retention policy TBD (likely 1y in UI, 7y cold). | V1 ships with retention policy documented and enforced via scheduled job. |
| Public API and webhooks | V3+ roadmap. | First V3+ phase doc explicitly scopes API; design follows the phase doc. |
| CRM integrations | V3+ roadmap. | First CRM integration enters V3+ phase doc. |
| Native mobile | V3+ roadmap. | Web-app usage justifies native investment (per "deferred until web usage justifies it" from V3+). |
| North-star metric | V1 launch decision; candidates in [success-metrics.md](../operations/success-metrics.md). | V1 launches with one metric chosen and tracked weekly. |
| Deal-team shopping workflow | V3+ roadmap. | V3+ phase doc scopes; ADR for consent + shared-fields model lands. |
| Email/phone provider | V2 outreach work. | V2 outreach ships with vendor selected and recorded as ADR. |
| CRM/inbox/calendar integrations | V3+ roadmap. | Per V3+ phase doc when scoped. |
| Outreach compliance policy | Design before V2 outreach work begins. | V2 outreach PR opens with compliance doc + suppression-list contract; legal review attached. |
| Provider marketplace monetization | V3+ roadmap. | V3+ phase doc scopes monetization. |
| Provider lead-sharing consent model | V3+ roadmap. | Per V3+ provider profiles ADR. |
| Entity-resolution review policy | Human-review queue thresholds finalized once V1 dedup is producing real data. | V1 ships dedup; thresholds tuned after first 30 days of real data; documented in `packages/dedup/agents.md`. |
| Browser Rendering reconsideration trigger | Cost crossover vs Fly Playwright at sustained volume. | Quarterly cost review either confirms Fly Playwright is still cheaper OR triggers an ADR superseding ADR 0010 for the browser lane. |
| CF native-binary support trigger | If/when CF ships a runtime extension for ffmpeg / Whisper, revisit transcribe placement. | CF announces; quarterly vendor-feature review picks it up; ADR superseding ADR 0009 (transcribe placement) drafted. |
| V1.5 OTel log + trace backend | Final choice (Loki + Tempo / Honeycomb / Datadog). | V1.5 cost + DX review picks one; recorded as ADR. |
| V1.5 VM topology | Single-VM, cluster, Grafana Cloud, or Chronosphere. | V1.5 review with ~30 days of V1 signal volume; recorded as ADR. |
| V1.5 PostHog tenancy model | Per-workspace PostHog "team" vs single instance with per-workspace properties. | V1 cross-workspace query needs documented; decision recorded. |
| V2 admin UI build vs buy | Native React panels vs Grafana embeds. | V1.5 user research surfaces operator preferences; decision recorded as part of V2 scope. |
| Broker-direct per-source ToS | Which directories and broker sites may be crawled in production ([broker-directory/agents.md](../../packages/broker-directory/agents.md) ToS table). BizBuySell listing data is high legal risk; IBBA directory lower risk; state DRE varies by state. | Legal review completes a signed "sources we will / won't crawl" table; each enabled `BrokerDirectoryAdapter` has a row with rationale; BBS bulk directory crawl blocked until explicit approval. |
| Broker-site LLM cost ceiling | `broker-site-extract` on ~3k–5k firms × pages × tokens ([broker-site/agents.md](../../packages/broker-site/agents.md)). | `tokenBudgetPerBroker` and global daily cap documented in [cost-budgets.md](../operations/cost-budgets.md); soft cap enforced in harness; pilot spend within budget for 30 days. |
| Pocket-listing freshness | Broker-site-only deals lack cross-source corroboration; need different `freshnessWarning` / dedup confidence than aggregator-sourced deals ([ADR 0016](0016-broker-direct-ingestion-lane.md)). | Policy documented in `packages/dedup/agents.md`; `packages/dedup/tests/pocket-listing-freshness.test.ts` passes; product surfaces "single-source" badge in explorer (V1.5). |
| State license DB sourcing | Which state DRE/commission databases are worth scraping vs. licensed data feeds ([broker-directory/agents.md](../../packages/broker-directory/agents.md) `state-dre/*`). | Per-state spike for CA, FL, AZ documented with URL, query interface, ToS, and row in broker-directory table; ADR or open-row closure before `state-dre/ca` ships in V1.5. |

## Validation criteria

This file is a working list, not a spec for shipped behavior. Its own discipline is:

- **Given** any row in the table, **when** read, **then** it has a non-empty "Resolved when" cell that names a concrete observable. Coverage: lint. Test: `scripts/lint-specs.mjs::open_decisions_have_resolved_when` (TBD V1).
- **Given** any row whose "Resolved when" condition is met, **when** it next gets touched, **then** it is removed from this file and a corresponding ADR is added to `docs/decisions/`. Coverage: PR review.
- **Given** an ADR landing, **when** it resolves a row in this file, **then** the row is removed in the same PR.
