# Data model

The canonical record types Clearbolt operates on. Storage layout (R2 / Neon / disk) is in [storage.md](storage.md). This document focuses on entities and their relationships.

## Two layers

- **Shared layer** — canonical deals, canonical businesses, brokers, listing snapshots, source records, dedup index, deal events. Lives in non-workspace-scoped tables. Read-only from inside any workspace's wiki.
- **Workspace layer** — saved searches, finds, feedback, notes, pipeline state, financial profile, market definition, captures, wiki pages, outreach. Scoped by `workspaceId`.

The two layers are joined by `workspaceFinds` and `workspaceCaptures` (workspace-private references to shared canonical entities).

## Workspaces and identity

Product **teams** are **workspaces** (tenant boundary; [ADR 0012](../decisions/0012-multi-tenancy-workspace-as-tenant.md)).

```
Workspace
  id, name, type, createdAt
Membership
  workspaceId, userId, role, invitedAt, joinedAt
User
  id, email, ... (managed by better-auth)
AuthSession
  id, userId, workspaceId (active), tokenClaims
```

Better-auth provides `User`, `AuthSession`, social providers, and orgs/workspaces. `packages/auth` wraps it ([packages/auth/agents.md](../../packages/auth/agents.md)). Product UI may say **team**; storage and ADR 0012 use **workspace** as the tenant id (`workspaceId`). Pipeline **projects**, per-user **dealbox / anti-dealbox**, and **user-owned market queries** (BizBuySell URLs, etc.): [teams-projects-dealbox.md](teams-projects-dealbox.md). Neon tables: `workspace_projects`, `user_project_dispositions`, `user_market_queries` (`packages/db/prisma`).

### Stable user id (not email)

Columns that attribute rows to a person (`userId` on `Membership`, `owner_user_id` on `UserMarketQuery`, `user_id` on `UserProjectDisposition`, `capturedByUserId` on `WorkspaceCapture`, etc.) store better-auth **`User.id`** — the same value as JWT `ClearboltClaims.userId`. **Do not** use `User.email` (or any OAuth `email` claim) as a foreign key or stable owner key: email can change; `User.id` does not for the same account. Org **invites** still address recipients by email; once accepted, persisted ownership uses `User.id` only. Contracts inventory: [contracts.md](contracts.md#identity-and-tenancy-cross-cutting); storage layout: [storage.md](storage.md).

## Source records and canonical deals

```
SourceRecord                                    # immutable observation
  id, workspaceId? (null for shared), adapter, sourceUrl,
  externalListingId?, brokerListingId?,
  rawEvidenceRef: { bucket, key, sha256, contentType, sizeBytes },
  parsedFields: jsonb,                          # AI/parsed extraction with provenance
  parserVersion, promptVersion?,
  fetchedAt, observedAt,
  canonicalDealId?,                             # FK populated after dedup
  status: 'parsed' | 'unmatched' | 'merged' | 'reviewing'

CanonicalDeal                                   # shared cache
  id,
  title, summary, askingPrice, currency, revenue, ebitda, sde,
  industry, naicsCode, geography (state, MSA, city, postal, lat, lng),
  brokerId?, listedAt, lastObservedAt,
  status: 'active' | 'under_contract' | 'withdrawn' | 'relisted' | 'sold' | 'delisted' | 'unknown',
  sources: jsonb,                               # [{ sourceRecordId, adapter, url, firstSeenAt, lastSeenAt }]
  fieldProvenance: jsonb,                       # { fieldName: { sourceRecordId, parserVersion, confidence } }
  intraSourceDuplicates: jsonb                  # other SourceRecords from the SAME adapter that match this deal

CanonicalBusiness                               # shared cache; harder layer
  id, legalName?, dbaName?, websiteDomain?,
  inferredFrom: SourceRecord[],
  confidence: 'low' | 'medium' | 'high',
  ...
```

**Multi-source preservation rule** (ADR [0003](../decisions/0003-multi-source-preservation.md)): SourceRecords are append-only. Dedup attaches sources; it never deletes them.

**Intra-source duplicates** (e.g. BizBuySell occasionally lists the same business twice with slightly different IDs): captured in `intraSourceDuplicates` so the operator can see which source entries the system folded together within the same adapter.

## Brokers

Brokers are first-class shared entities, not flat strings.

```
Broker
  id, normalizedName, displayName, firmId?,
  websiteDomain?, primaryContactEmail?, primaryContactPhone?,
  lastObservedAt,
  sources: jsonb,                               # [{ sourceRecordId, adapter, ...}]
  enrichmentStatus: 'pending' | 'enriched' | 'no-website' | 'error',
  fieldProvenance: jsonb

BrokerFirm
  id, normalizedName, websiteDomain?, address?, ...

BrokerListing                                   # association table
  brokerId, canonicalDealId, sourceRecordIds: string[]
```

Broker enrichment is its own workflow: from a `Broker` row, the ingestion harness can crawl the broker's website (where allowed) to find more listings and attach them. Marketplace adapters surface brokers via `extractBrokerLinks`; broker-direct enumeration lives in [`packages/broker-directory`](../../packages/broker-directory/agents.md) per [ADR 0016](../decisions/0016-broker-direct-ingestion-lane.md).

### Broker materialization workflow

**Inputs** (any of these may create or update a shared `Broker` row):

| Input | Typical source | Fields used |
|-------|----------------|-------------|
| `BrokerEndpoint` | `Adapter.extractBrokerLinks` after listing or broker-profile fetch | `profileUrl`, `name`, `firm`, `website`, `phone`, `email` |
| `parsedFields.brokerName` (+ optional `brokerFirm`) | Listing detail `SourceRecord` | Contact person + firm string on the listing page |
| `BrokerCandidate` | `BrokerDirectoryAdapter.discoverBrokers` ([broker-directory](../../packages/broker-directory/agents.md)) | `normalizedName`, `websiteDomain`, `profileUrl`, `firmName` |

**Dedup keys** (all must match for an automatic merge; otherwise a human-review queue row is created):

1. **Primary:** `websiteDomain` (registrable domain, lowercased) when present on both sides.
2. **Secondary:** `normalizedName` + `firmId` (or normalized firm name when `BrokerFirm` is not yet materialized).
3. **Tertiary:** marketplace `profileUrl` per adapter (`bizbuysell`, `bizquest`, `dealstream`, …) stored in `Broker.sources[]`.

`normalizedName` is a lowercase, punctuation-stripped display name used only for matching — `displayName` preserves the source spelling.

**`BrokerFirm` materialization:** when a broker observation includes a firm name or `worksFor` JSON-LD, upsert `BrokerFirm` by `normalizedName` + `websiteDomain`, then set `Broker.firmId`.

**`BrokerListing` population:** after a `SourceRecord` is ingested and attached to a `CanonicalDeal`, if the record carries `parsedFields.brokerId` (post-materialization) or resolvable broker keys, upsert `BrokerListing(brokerId, canonicalDealId)` and append the `sourceRecordId`. Broker-profile inventory parsers (e.g. BizBuySell active listings on a profile page) enqueue listing fetches first; `BrokerListing` rows are written when those listings ingest.

**`enrichmentStatus` transitions:**

```
pending → enriched     # broker-site crawl succeeded and ≥1 listing SourceRecord ingested
pending → no-website   # no public site, robots disallow, or empty listings index
pending → error        # repeated fetch/parse failures past cooldown
```

#### Worked example (marketplace path)

1. BizBuySell listing ingest produces `SourceRecord` with `parsedFields.brokerName = "Jane Smith"`, `brokerFirm = "Pacific Business Advisors"`, `brokerProfileUrl = https://www.bizbuysell.com/business-broker/jane-smith/12345/`.
2. Materializer matches or creates `BrokerFirm` for Pacific Business Advisors, then `Broker` for Jane Smith with `sources: [{ adapter: "bizbuysell", profileUrl: "…/12345/" }]`.
3. `CanonicalDeal.brokerId` is set; `BrokerListing` links broker ↔ deal ↔ source record.
4. Optional: broker-profile fetch discovers three more active listing refs on Jane's profile; each listing ingests and adds `BrokerListing` rows (dedup may fold them into existing `CanonicalDeal`s).

The same `Broker` row is later updated (not duplicated) when IBBA directory enumeration surfaces the same `websiteDomain` in the broker-direct lane ([ADR 0016](../decisions/0016-broker-direct-ingestion-lane.md)).

### Broker directory refs (marketplace catalogs)

State/regional **listing** catalogs yield `ListingRef`s. **Broker directory** catalogs (e.g. BizBuySell `/business-brokers/{state}/`) yield `BrokerDirectoryRef` — same pagination machinery as listing catalogs, different discovery target:

```
BrokerDirectoryRef
  profileUrl, externalBrokerId?, name?, firm?, state?, sourceAdapter
```

Spec shape lives in marketplace adapter `agents.md` files; implementation target: `packages/scraper/src/adapters/types.ts` (alongside `ListingRef`).

## Listing lifecycle and change tracking

```
DealEvent                                       # append-only per CanonicalDeal
  id, canonicalDealId, eventType, occurredAt,
  fromValue?, toValue?,
  sourceRecordId?,                              # which observation triggered the event
  workspaceVisibility: 'shared' | 'workspace'   # most events are shared; workspace pipeline events are scoped

  eventType ∈ {
    priceChanged, statusChanged, brokerChanged, descriptionChanged,
    relisted, withdrawn, sold,
    sourceAdded, sourceLost, freshnessWarning
  }
```

Workspace-level pipeline events (`movedToOutreach`, `passed`, etc.) are stored in a separate `WorkspaceDealEvent` table to keep them workspace-private.

## Captures (universal clipper)

```
WorkspaceCapture                                # workspace-private
  id, workspaceId, capturedByUserId,
  sourceUrl, host,
  rawHtmlR2Key, markdownR2Key,
  extractedFields: jsonb,                       # AI extraction proposal
  userConfirmedFields: jsonb,                   # what the user actually saved
  summary?,
  attachToCanonicalDealId?,                     # optional pin to a known shared deal
  hostHeuristicVersion,
  status: 'pending' | 'processed' | 'attached' | 'discarded',
  createdAt, processedAt
```

Captures are never folded into the shared listing cache without explicit user action. See [capture.md](capture.md).

## Wiki

```
WikiPage                                        # index row in MetadataStore; content lives in WikiStore
  id, workspaceId, path,                        # e.g. "deals/<dealId>/financials.md"
  category: 'deal' | 'entity' | 'concept' | 'conversation' | 'index' | 'log',
  targetId?,                                    # canonicalDealId / brokerId / etc.
  contentR2Key,
  contentSha256,
  embeddingRef?,                                # pgvector reference (V1+)
  sourcePageRefs: jsonb,                        # which SourceRecords/Captures contributed
  lastModified, lastModifiedBy: 'agent' | 'user',
  maintainerVersion                             # which version of the maintainer wrote this
```

Wiki content (the markdown itself) lives in `WikiStore` (disk in V0, R2 in V1+). Index rows live in `MetadataStore` for fast queries. See [wiki.md](wiki.md).

## Workspace search and feedback

```
WorkspaceSavedSearch
  id, workspaceId, name, kind: 'marketplace_url' | 'criteria' | 'off_market',
  parsedParams: jsonb, marketplaceUrl?,
  schedule, lastRunAt, status

WorkspaceSearchRun
  id, savedSearchId, startedAt, finishedAt,
  resultMembership: jsonb,                      # [canonicalDealId, ...]
  rankingMetadata: jsonb

WorkspaceFind
  id, workspaceId, canonicalDealId,
  surfaceSource: 'search' | 'import' | 'manual' | 'capture' | 'recommendation',
  firstSurfacedAt, lastSurfacedAt

WorkspaceFeedback                               # likes, dislikes, saves, passes, advances
  id, workspaceId, userId, canonicalDealId,
  feedbackType, reason?, createdAt

WorkspaceRankingProfile                         # learned preferences
  workspaceId, profile: jsonb, updatedAt
```

## Buyer capacity and fit

```
BuyerFinancialProfile                           # workspace-private, highly sensitive
  workspaceId, liquidity, availableEquity,
  backerCommitments, debtComfort, sbaAssumptions, financingPreferences, ...

AcquisitionCriteria
  workspaceId, industries, geographies, dealSize, ...

FinancingScenario
  id, workspaceId, name, downPayment, leverage, interestRate, amortization,
  sellerNote, dscr, fees

DealFitScore                                    # per (workspace, canonicalDeal) pair
  workspaceId, canonicalDealId,
  thesisFitScore, financeabilityScore, riskScore,
  explanation: jsonb,
  computedAt, modelVersion
```

## Market, quality, and roadmap deal-team records

```
MarketDefinition
  id, workspaceId, version, document (markdown), structuredCriteria: jsonb,
  positiveScreens, negativeScreens, exampleFits, excludedExamples

DealQualityScore
  id, canonicalDealId,
  workspaceId?,                                 # null for shared baseline; per-workspace overrides allowed
  dimensions: jsonb,                            # { source, financial, business, process, diligence }
  confidence, evidence: jsonb, computedAt

DiligenceGap
  id, canonicalDealId, workspaceId,
  gap, evidenceRef?, status

DealTeamNeed                                    # roadmap (V3+)
ProviderMatch                                   # roadmap (V3+)
ProviderProfile                                 # roadmap (V3+)
ReferralEvent                                   # roadmap (V3+)
```

## Contacts and outreach

```
Contact                                         # workspace-private
  id, workspaceId, role, name, firmId?, brokerId?, ...

ContactMethod
  contactId, channel, value, confidence, provenance

OutreachAttempt
  id, workspaceId, contactId, channel, sentAt, status, payload

OutreachThread
  id, workspaceId, contactId, attempts: jsonb

NextAction
  id, workspaceId, dueAt, kind, payload
```

## Audit log

```
AuditEvent
  id, workspaceId, actorUserId,
  category: 'membership' | 'financial_profile' | 'outreach' | 'provider_share' |
            'saved_search' | 'pipeline_state' | 'document' | 'export' | 'deletion',
  action, target, payload: jsonb, createdAt
```

## Implemented schema today (`packages/db`)

The checked-in Prisma schema is a **walking skeleton** — not the full V1 sketch below. Migrations:

- `20260518000000_init` — metadata JSONB + pipeline + better-auth.
- `20260519000000_deal_search_fts` — shared lexical index.

| Model / table | Shape today |
|---------------|-------------|
| `SourceRecordRow`, `CanonicalDealRow`, `DedupMappingRow`, `DomainProfileRow` | `id` + `payload` JSONB (disk layout in Postgres) |
| `DealSearchIndexRow` | `canonical_id`, `adapters[]`, `title`, `location`, `document`, `search_vector` (trigger-maintained) |
| `WorkspaceProjectRow`, `UserProjectDispositionRow`, `UserMarketQueryRow` | relational columns per [teams-projects-dealbox.md](teams-projects-dealbox.md) |
| `User`, `Session`, `Organization`, `Member`, `Invitation`, … | better-auth (merged via `pnpm --filter @clearbolt/auth auth:schema`) |

Brokers, `DealEvent`, `MergeCandidate`, wiki index, pgvector siblings, and most workspace analytics tables from the sketch below are **not migrated yet**. Add them only through `packages/db` migrations when the corresponding surface ships.

## Prisma v7 schema sketch (V1+ target)

This is illustrative — exact schema lands in `packages/db/prisma/schema.prisma`. The shape:

```prisma
model Workspace {
  id          String       @id @default(cuid())
  name        String
  type        String
  createdAt   DateTime     @default(now())
  members     Membership[]
  savedSearches WorkspaceSavedSearch[]
  finds       WorkspaceFind[]
  captures    WorkspaceCapture[]
  feedback    WorkspaceFeedback[]
  fitScores   DealFitScore[]
  wikiPages   WikiPage[]
  // ... etc
  @@index([type])
}

model SourceRecord {
  id              String   @id @default(cuid())
  adapter         String
  sourceUrl       String
  externalListingId String?
  brokerListingId   String?
  evidenceBucket  String
  evidenceKey     String
  evidenceSha256  String   @unique  // dedupes raw payloads across URLs/tracking params
  parsedFields    Json
  parserVersion   String
  promptVersion   String?
  fetchedAt       DateTime
  observedAt      DateTime
  canonicalDealId String?
  status          String

  canonicalDeal CanonicalDeal? @relation(fields: [canonicalDealId], references: [id])

  @@unique([adapter, externalListingId])               // dedup key 1
  @@unique([adapter, brokerListingId, externalListingId])  // dedup key 2 (sparse)
  @@index([sourceUrl])
  @@index([canonicalDealId])
}

model CanonicalDeal {
  id              String   @id @default(cuid())
  title           String
  summary         String?
  askingPrice     Decimal?
  currency        String   @default("USD")
  revenue         Decimal?
  ebitda          Decimal?
  sde             Decimal?
  industry        String?
  naicsCode       String?
  state           String?
  msa             String?
  city            String?
  postal          String?
  brokerId        String?
  listedAt        DateTime?
  lastObservedAt  DateTime
  status          String
  sources         Json     // [{ sourceRecordId, adapter, url, firstSeenAt, lastSeenAt }]
  fieldProvenance Json
  intraSourceDups Json

  broker        Broker?         @relation(fields: [brokerId], references: [id])
  sourceRecords SourceRecord[]
  events        DealEvent[]
  qualityScores DealQualityScore[]
  fitScores     DealFitScore[]

  @@index([state, msa])
  @@index([naicsCode])
  @@index([status])
  @@index([brokerId])
}

// pgvector embedding column lives on a sibling table in V1+:
model CanonicalDealEmbedding {
  canonicalDealId String  @id
  embedding       Unsupported("vector(1536)")
  modelName       String
  generatedAt     DateTime

  @@index([embedding], type: Hnsw)
}
```

V0 mirrors the metadata shape in JSON files under `data/` with manual indexes. The full relational sketch below is the **V1+ target**; the implemented subset lives in `packages/db/prisma/schema.prisma` (see [Implemented schema today](#implemented-schema-today-packagesdb)).

## Internationalization, currency, region

V1 is US-centric. Design records so adding regions later is not a rewrite.

- All money fields carry an explicit ISO 4217 **currency code**; never assume USD.
- Display currency may differ from stored currency; conversions stored as snapshots with rate and timestamp when used.
- Distance fields explicit unit (mi/km).
- Date/time stored UTC; render in workspace or user time zone.
- Language: en-US for V1; copy should not assume US-specific terms.
- Region-specific regulatory features (SBA, etc.) gated by region rather than hardcoded as defaults.

## Geography and industry taxonomy

- Geography: ISO 3166 country + region/state + county + city + postal + lat/lng. US: standardize on state + MSA + county; support radius queries from a city or zip. Service-area businesses capture both physical address and operating radius.
- Industry: primary classification **NAICS** with explicit version, plus a Clearbolt-internal "category" overlay for buyer-friendly grouping (e.g. "HVAC", "MSP", "Pool routes"). Source-provided category strings preserved as evidence. SIC support only as needed for legacy data.

`TODO:` Pick NAICS edition; decide internal category vocabulary; define source-category mapping policy.

## Validation criteria

### Brokers
- **Given** a `SourceRecord` with `parsedFields.brokerName` and a resolvable `brokerProfileUrl`, **when** broker materialization runs after ingest, **then** exactly one `Broker` row exists for that profile URL and `CanonicalDeal.brokerId` points to it. Coverage: integration. Test: `packages/storage-neon/tests/broker-materialization.test.ts` (TBD V1).
- **Given** two observations with the same `websiteDomain` and compatible `normalizedName`, **when** materialized from different adapters, **then** they share one `Broker` row and `sources` contains both adapters. Coverage: integration. Test: `packages/storage-neon/tests/broker-dedup-by-domain.test.ts` (TBD V1).
- **Given** a `BrokerListing` row, **when** queried, **then** `brokerId`, `canonicalDealId`, and every `sourceRecordId` reference real rows. Coverage: integration. Test: `packages/storage-neon/tests/broker-listing-integrity.test.ts` (TBD V1).

### Functional
- **Given** the V1+ Prisma schema, **when** generated, **then** every model in this doc has a corresponding Prisma model with the same fields and indexes (drift = bug). Coverage: lint. Test: `packages/storage-neon/tests/schema-vs-data-model.test.ts` (TBD V1).
- **Given** any `SourceRecord`, **when** written, **then** `evidenceSha256` is unique across all records (content-addressed dedup at the blob layer). Coverage: conformance. Test: `packages/storage/src/conformance/source-record-store.suite.ts::sha256_unique`.
- **Given** any `CanonicalDeal`, **when** queried, **then** every entry in `sources[]` references a real `SourceRecord` (no dangling refs). Coverage: integration. Test: `packages/storage/tests/canonical-deal-integrity.test.ts`.
- **Given** any `CanonicalDeal`, **when** any field has `fieldProvenance[fieldName]` populated, **then** the referenced `SourceRecord` exists and contains that field in `parsedFields`. Coverage: integration. Test: `packages/storage/tests/field-provenance-integrity.test.ts`.

### Boundary
- **Given** any workspace-scoped table (Workspace*, BuyerFinancialProfile, WorkspaceCapture, WikiPage, etc.), **when** queried without an explicit `workspaceId` filter, **then** the query is rejected at the data-access layer. Coverage: lint + runtime guard. Test: `packages/storage-neon/tests/workspace-scope-required.test.ts` (TBD V1).
- **Given** the shared cache (CanonicalDeal, Broker, BrokerFirm, BrokerListing, DealEvent with `workspaceVisibility: 'shared'`), **when** queried, **then** no `workspaceId` is required (these are global). Coverage: integration. Test: `packages/storage-neon/tests/shared-cache-readable.test.ts` (TBD V1).
- **Given** `UserMarketQuery`, `UserProjectDisposition`, `Membership`, or `WorkspaceCapture` rows, **when** inspected, **then** user-attribution columns store internal `User.id` (JWT `userId`) and never use email as the persisted owner key. Coverage: integration. Test: `packages/storage-neon/tests/user-scoped-owner-is-user-id.test.ts`.

### Internationalization
- **Given** any money-typed field, **when** written, **then** it carries an explicit ISO 4217 currency code (no implicit USD). Coverage: lint. Test: `packages/core/tests/money-fields-iso4217.test.ts` (TBD V1).
- **Given** any datetime field, **when** written, **then** it is stored as UTC. Coverage: type-level (TypeScript `Date` always UTC); DB-level (Postgres `timestamptz`). Test: `packages/storage-neon/tests/datetime-utc.test.ts` (TBD V1).

### Audit
- **Given** any `AuditEvent`-eligible action (membership change, financial profile edit, outreach send, provider share, deletion, export), **when** the action runs, **then** an `AuditEvent` row is appended within the same transaction. Coverage: integration. Test: `services/audit/tests/audit-on-every-eligible-action.test.ts` (TBD V1).
