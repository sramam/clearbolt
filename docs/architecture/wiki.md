# Per-deal LLM wiki (Karpathy pattern)

Captured in [`packages/wiki/agents.md`](../../packages/wiki/agents.md). ADR: [../decisions/0007-per-deal-llm-wiki.md](../decisions/0007-per-deal-llm-wiki.md).

Inspired by Andrej Karpathy's [llm-wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — markdown the model both reads and writes, with `AGENTS.md` as the schema.

## Three layers

1. **Raw sources** (immutable) — every `SourceRecord`, `WorkspaceCapture`, `Transcript` lives in `EvidenceStore` and is never modified.
2. **Wiki** (LLM-maintained markdown) — per-workspace per-deal directory tree of pages.
3. **Schema** (`AGENTS.md`) — the maintainer agent reads this to know how to behave: page categories, naming conventions, required cross-references, lint rules, what to write back, what to leave alone.

## Original sources in markdown (hard requirement)

Markdown the maintainer writes is useless for diligence if you cannot jump back to the live listing, broker site, or capture. **Every page that summarizes scraped or captured web content must keep a human-clickable link to the original source**, not only an internal id.

- **Marketplace / HTTP listings:** include at least one markdown link using the **canonical HTTPS listing URL** (same host/path the user would open in a browser: typically `SourceRecord.url` or the post-redirect `finalUrl` stored with the evidence). Plain hostname text without a scheme is not enough.
- **Per-deal rollups** (`summary.md`, `financials.md`, `operations.md`, etc.): repeat or link to `deals/<id>/sources.md` where each row already lists `[label](https://…)` plus optional `sources.md#<sourceRecordId>` anchors for deep links into the evidence table.
- **Ad-hoc ingest pages** (`deals/<id>/pages/source-*.md`): must open with or close with a **Sources** block: bullet list of `[short label](full listing URL)` lines; add `SourceRecord` id in prose or anchor for traceability.
- **WorkspaceCapture / Transcript artifacts:** link to the capture or transcript viewer URL (or stable deep link) where humans can replay the original, not only the internal capture id.

`wiki-lint` treats “claim supported only by an internal id with no outbound URL where a URL exists” as a fixable violation unless the source is genuinely offline-only.

## Layout (per workspace)

```
workspaces/<workspaceId>/wiki/
  AGENTS.md                              # the schema: how the maintainer behaves
  index.md                               # content catalog (pages by category)
  log.md                                 # chronological append-only event log
  deals/
    <canonicalDealId>/
      index.md                           # the deal's own wiki home (links to pages below)
      summary.md
      sources.md                         # provenance per source record
      log.md                             # per-deal event log (price changes, status, captures)
      financials.md
      operations.md
      diligence.md
      questions.md                       # outstanding questions / gaps
      pages/                             # ad-hoc analysis pages
  entities/
    brokers/<brokerId>.md
    owners/<ownerId>.md
    firms/<firmId>.md
  concepts/
    industries/<naicsCode>.md
    geographies/<msaCode>.md
    valuation/<topic>.md
  conversations/                         # AI-tool transcripts captured via the clipper
    <captureId>.md
```

## Maintainer agent operations

Built on top of the harness ([harness.md](harness.md)). Each operation is a skill (`.agents/skills/<name>.md`) loaded by the harness.

### Ingest (skill `wiki-ingest`)

Given a new `SourceRecord`, `WorkspaceCapture`, or `Transcript`:

1. Read existing wiki pages that may be touched (deal summary, financials, operations, sources, broker page, industry page).
2. Write a summary page for the new artifact (e.g. `deals/<id>/pages/source-2025-05-08-bizbuysell.md`), and **include markdown links to the original listing or capture URLs** (see [Original sources in markdown](#original-sources-in-markdown-hard-requirement)).
3. Update entity pages (broker, owner, firm) with new facts and citations.
4. Update concept pages (industry, geography) with new evidence if the deal is material to them.
5. Append to `log.md` (workspace-level) and to the deal's `log.md`.
6. Refresh the deal's `index.md` and the workspace's `index.md`.

One ingest typically touches 8-15 pages.

### Query (skill `wiki-query`)

Given a question + workspace:

1. Search lexical + vector indexes to find relevant pages.
2. Read the candidate pages.
3. Synthesise an answer with citations to the pages.
4. **File good answers back as new pages** (`deals/<id>/pages/q-<slug>.md`) so the wiki compounds — answering once should not require answering again.

### Lint (skill `wiki-lint`)

Periodic background pass:

- Contradiction detection across pages (e.g. asking price says $1.2M on `summary.md`, $1.5M on `financials.md`).
- Stale claim detection (newer source supersedes older).
- Orphan page detection (pages not linked from `index.md`).
- Missing-page detection (deal has no `financials.md` despite financial source records).
- Missing cross-references (broker mentioned in `summary.md` not linked to the broker entity page).

High-confidence fixes auto-apply; low-confidence ones queue for human review.

## Two layers of compartmentalisation

ADR: [../decisions/0012-multi-tenancy-workspace-as-tenant.md](../decisions/0012-multi-tenancy-workspace-as-tenant.md).

- **Per-deal wiki pages and per-workspace conversation captures are workspace-private.** Never shared across workspaces. Stored under `workspaces/<workspaceId>/wiki/...`.
- **Cross-workspace shared layer** (canonical deals, brokers, listing snapshots) lives in the shared cache (Neon + R2 under `shared/...`) and is read-only from inside a workspace's wiki. The wiki maintainer can cite shared facts but cannot mutate them.

## Storage

- V0: `wiki-fs` writes the directory tree under `workspaces/<id>/wiki/` on local disk; optional `git init` for version history.
- V1+: `wiki-r2` writes markdown to R2 with content-addressed snapshots; `MetadataStore` indexes pages (path, slug, last-modified, source-page count, embedding ref) for fast querying without scanning the bucket.

## Where the maintainer runs

Wiki maintainer runs on **Fly.io**. Long-running, multi-tool, multi-page workflows fit cleanly on Fly's unconstrained compute. CF Workers can run lighter `wiki-query` calls if we want low-latency reads from edge.

## Validation criteria

### Functional
- **Given** a new `SourceRecord`, **when** `wiki-ingest` runs, **then** it touches between 5 and 25 wiki pages (deal summary, financials, operations, sources, broker page, industry page, etc.) and the deal's `index.md` is refreshed. Coverage: integration. Test: `packages/wiki/tests/ingest-touches-affected-pages.test.ts` (TBD V1).
- **Given** a workspace question, **when** `wiki-query` runs, **then** it (a) returns an answer with citations to wiki pages, AND (b) files a new page `deals/<id>/pages/q-<slug>.md` so the wiki compounds. Coverage: integration. Test: `packages/wiki/tests/query-files-back-as-page.test.ts` (TBD V1).
- **Given** the `wiki-lint` skill, **when** run on a deal whose `summary.md` says price=$1.2M and `financials.md` says price=$1.5M, **then** a contradiction is flagged for human review (high-confidence cases auto-correct; this one queues). Coverage: golden-set. Test: `packages/wiki/tests/lint-contradiction-detection.test.ts` (TBD V1).
- **Given** the `wiki-lint` skill, **when** run on a workspace, **then** orphan pages (not linked from `index.md`) and missing pages (deal has financial sources but no `financials.md`) are detected. Coverage: integration. Test: `packages/wiki/tests/lint-orphan-and-missing.test.ts` (TBD V1).

### Immutability
- **Given** the wiki maintainer agent, **when** it processes any input, **then** it does not modify any record in `EvidenceStore` (raw sources are immutable). Coverage: contract guard + integration. Test: `packages/wiki/tests/maintainer-never-mutates-evidence.test.ts` (TBD V1).

### Compartmentalisation
- **Given** the wiki maintainer running in workspace A, **when** it queries data, **then** it cannot read workspace B's wiki pages, captures, or financial profile. Coverage: integration. Test: `packages/wiki/tests/cross-workspace-isolation.test.ts` (TBD V1).
- **Given** a wiki page in workspace A's wiki, **when** it cites a shared canonical deal, **then** the citation is read-only — the maintainer cannot mutate the canonical deal. Coverage: contract guard. Test: `packages/wiki/tests/shared-cache-readonly-from-wiki.test.ts` (TBD V1).

### Quality / accretion
- **Given** 30 days of V1 usage, **when** measured, **then** wiki pages per deal grow over time (accretion) AND `wiki.feedback_given` per `wiki.query_asked` ratio is ≥ 10% (users find the answers useful). Coverage: smoke (PostHog dashboard). Test: `scripts/wiki-health.mjs` (TBD V1.5).
- **Given** any wiki page, **when** queried, **then** every factual claim has a citation back to a `SourceRecord`, `Capture`, or `Transcript` (no unsourced claims). Coverage: golden-set + sampled human review. Test: `packages/wiki/tests/citations-required.test.ts` (TBD V1).
- **Given** any maintainer-written page that summarizes a web `SourceRecord`, **when** read, **then** the page contains at least one markdown link whose target is the **original listing HTTPS URL** (or capture/transcript deep link), not only `sources.md#` anchors or bare ids. Coverage: golden-set + `wiki-lint`. Test: `packages/wiki/tests/original-source-url-linked.test.ts` (TBD V1).

### Storage
- **Given** the V0 `wiki-fs` backend, **when** the maintainer writes a page, **then** the page appears as a markdown file under `workspaces/<id>/wiki/` and is human-readable with `cat`. Coverage: integration. Test: `packages/wiki-fs/tests/written-pages-are-cat-readable.test.ts` (TBD V0).
- **Given** the V1 `wiki-r2` backend, **when** a page is written, **then** the new content gets a content-addressed snapshot (history is preserved), `MetadataStore.WikiPage.contentSha256` updates, and the previous version remains addressable. Coverage: integration. Test: `packages/wiki-r2/tests/snapshot-history.test.ts` (TBD V1).
