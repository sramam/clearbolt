# `packages/wiki`

> Runtime: **both**. Heavy lints prefer Fly.io.

The Karpathy-style per-deal LLM wiki maintainer, built on top of [`packages/agents`](../agents/agents.md).

Cross-cuts [`docs/architecture/wiki.md`](../../docs/architecture/wiki.md). ADR: [`docs/decisions/0007-per-deal-llm-wiki.md`](../../docs/decisions/0007-per-deal-llm-wiki.md).

## What this package provides

- The `wiki-ingest`, `wiki-query`, `wiki-lint` skills as `.agents/skills/*.md` templates.
- A `WikiMaintainer` class that wraps the harness with workspace + wiki context.
- Machine-parseable skill results (`WikiIngestReport`, `WikiAnswer`, `WikiLintReport`, …) use **Zod** at the harness boundary ([`packages/agents`](../agents/agents.md) `session.prompt` / `session.task` `result` schemas).
- The `AGENTS.md` schema template for new workspaces' wiki directories.
- Page templates (`summary.md`, `financials.md`, `sources.md`, `log.md`, ...) seeded on first ingest.

## Original listing and capture URLs in markdown

Maintainer output must stay **grounded in the open web**: any page that summarizes a scraped listing or capture includes at least one **markdown link** whose URL is the **original HTTPS listing URL** (or capture / transcript deep link humans can open). Internal anchors like `sources.md#<sourceRecordId>` are encouraged *in addition* for traceability, not as a substitute for the outbound URL when one exists.

The workspace `AGENTS.md` schema should require a **Sources** subsection (or equivalent) on `deals/<id>/pages/source-*.md` and require `sources.md` rows to use `[label](https://…)` for the listing column.

## Layout schema

Per workspace:

```
workspaces/<workspaceId>/wiki/
  AGENTS.md
  index.md
  log.md
  deals/<canonicalDealId>/
    index.md
    summary.md
    sources.md
    log.md
    financials.md
    operations.md
    diligence.md
    questions.md
    pages/
  entities/
    brokers/<brokerId>.md
    owners/<ownerId>.md
    firms/<firmId>.md
  concepts/
    industries/<naicsCode>.md
    geographies/<msaCode>.md
    valuation/<topic>.md
  conversations/<captureId>.md
```

The maintainer seeds the workspace `AGENTS.md` with the schema (page categories, naming conventions, required cross-references, lint rules) on workspace creation.

## Skills

### `wiki-ingest`

```yaml
---
name: wiki-ingest
description: Update the wiki to reflect a new SourceRecord, WorkspaceCapture, or Transcript.
args:
  workspaceId: string
  artifact: { kind: 'source' | 'capture' | 'transcript', id: string }
result: WikiIngestReport
---

You are the Clearbolt wiki maintainer for workspace {{workspaceId}}.

A new {{artifact.kind}} ({{artifact.id}}) has arrived. Read existing pages
that may be touched, write a summary page for the new artifact, update
entity pages (broker, owner, firm), update concept pages where material,
append to the deal's log.md and the workspace's log.md, and refresh
index.md files.

Hard rule: every new or updated page that reflects a SourceRecord MUST
include a markdown link to that record's original listing URL (https)
in the body or in a trailing "Sources" bullet list. For captures and
transcripts, link to the human-viewable replay URL when available.

Use these tools:
  - read(path)
  - write(path, content)
  - listListings({ workspaceId, criteria })
  - lookupBroker({ id | name })
  - getCanonicalDeal({ id })

Follow the workspace AGENTS.md (loaded automatically) for naming
conventions, required cross-references, and what counts as a citation.
```

One ingest typically touches 8-15 pages.

### `wiki-query`

```yaml
---
name: wiki-query
description: Answer a question about the workspace using the wiki, then file the answer back as a new page.
args:
  workspaceId: string
  question: string
result: WikiAnswer
---

You are the Clearbolt wiki maintainer for workspace {{workspaceId}}.

Question: {{question}}

1. Search the wiki (lexical + vector via the search tool).
2. Read candidate pages.
3. Synthesize an answer with citations (include outbound listing/capture
   links when the answer restates scraped facts).
4. File the answer back as a new page under deals/<id>/pages/q-<slug>.md
   so the wiki compounds.

Return the answer with citations.
```

Filing the answer back means the wiki compounds — answering once should not require answering again.

### `wiki-lint`

```yaml
---
name: wiki-lint
description: Periodic background pass detecting contradictions, stale claims, orphans, missing pages, and missing cross-references.
args:
  workspaceId: string
  scope?: { dealId?: string }
result: WikiLintReport
---

You are the Clearbolt wiki maintainer for workspace {{workspaceId}}.

Lint the wiki for:
  - Contradictions across pages.
  - Stale claims (newer source supersedes older).
  - Orphan pages (not linked from index.md).
  - Missing pages (deal has financial sources but no financials.md).
  - Missing cross-references (broker mentioned in summary.md but not
    linked to broker entity page).
  - Pages that summarize SourceRecords but lack an https:// outbound
    markdown link to the original listing (when the URL is known).

For high-confidence fixes, apply them. For low-confidence ones, queue
for human review.
```

## Two layers of compartmentalisation

Per [`docs/decisions/0012-multi-tenancy-workspace-as-tenant.md`](../../docs/decisions/0012-multi-tenancy-workspace-as-tenant.md):

- Per-deal wiki pages and per-workspace conversation captures are workspace-private.
- Cross-workspace shared layer (canonical deals, brokers, listing snapshots) is read-only from inside a workspace's wiki — the maintainer can cite shared facts but cannot mutate them.

## Storage

- V0: [`packages/wiki-fs`](../wiki-fs/agents.md).
- V1+: [`packages/wiki-r2`](../wiki-r2/agents.md).

## Where the maintainer runs

- Wiki maintainer runs on **Fly.io** for ingest/lint (long-running, multi-page, multi-tool).
- `wiki-query` can run on **CF Workers** when interactive low-latency queries from the deal page matter, since query is shorter and read-only.

## Validation criteria

### Skill contracts
- **Given** the `wiki-ingest` skill, **when** invoked with a `SourceRecord`, `WorkspaceCapture`, or `Transcript` artifact, **then** it returns a `WikiIngestReport` with: pages touched, pages created, citation count, and at least one `index.md` updated. Coverage: integration. Test: `packages/wiki/tests/wiki-ingest-report-shape.test.ts` (TBD V1).
- **Given** the `wiki-query` skill, **when** asked a question that the wiki has facts for, **then** the returned `WikiAnswer` includes citations and a new page is filed under `deals/<id>/pages/q-<slug>.md`. Coverage: integration. Test: `packages/wiki/tests/wiki-query-files-back.test.ts` (TBD V1). Falsifiability for the "wiki compounds" claim.
- **Given** the `wiki-lint` skill, **when** run on a wiki with a known contradiction in fixtures, **then** the contradiction is reported in `WikiLintReport`. Coverage: golden-set. Test: `packages/wiki/tests/wiki-lint-finds-contradiction.test.ts` (TBD V1).

### Provenance / "evidence over guesses"
- **Given** any wiki page produced by the maintainer, **when** read, **then** every non-trivial claim links to a source via `[fact](sources.md#evidence-id)` style citation. Coverage: lint over wiki-fs in tests. Test: `packages/wiki/tests/no-claim-without-citation.test.ts` (TBD V1).
- **Given** any page that summarizes a `SourceRecord` from a marketplace, **when** read, **then** the page includes at least one markdown link with an `https://` URL pointing at the **original listing** (user-openable), per [Original listing and capture URLs in markdown](#original-listing-and-capture-urls-in-markdown). Coverage: `wiki-lint` + golden-set. Test: `packages/wiki/tests/original-source-url-linked.test.ts` (TBD V1).

### Tenant isolation (hard rule)
- **Given** workspace A's `WikiMaintainer`, **when** invoked, **then** it cannot read or write under `workspaces/<other>/wiki/`. Coverage: integration. Test: `packages/wiki/tests/maintainer-tenant-scoped.test.ts` (TBD V1).
- **Given** the maintainer reading shared canonical facts, **when** tools return shared data, **then** the maintainer can cite but not mutate. Coverage: integration. Test: `packages/wiki/tests/shared-readonly.test.ts` (TBD V1).

### User-edit safety (hard rule)
- **Given** a wiki page flagged `userEdited=true`, **when** the maintainer runs ingest or lint, **then** the page's prose is never overwritten; lint diffs go to a review queue. Coverage: integration. Test: `packages/wiki/tests/respect-user-edit.test.ts` (TBD V1). Cross-link to [`docs/operations/failure-modes.md`](../../docs/operations/failure-modes.md).

### Maintainer versioning
- **Given** any page write by the maintainer, **when** complete, **then** the maintainer version is stamped in the `WikiPage` index row. Coverage: integration. Test: `packages/wiki/tests/maintainer-version-stamped.test.ts` (TBD V1).

### Workspace seeding
- **Given** a new workspace, **when** the wiki is initialized, **then** the workspace's `AGENTS.md` is seeded with the schema (page categories, naming conventions, lint rules). Coverage: integration. Test: `packages/wiki/tests/workspace-seeded.test.ts` (TBD V1).

### Cross-link
- Architecture: [`docs/architecture/wiki.md`](../../docs/architecture/wiki.md).
- ADR: [`docs/decisions/0007-per-deal-llm-wiki.md`](../../docs/decisions/0007-per-deal-llm-wiki.md).
