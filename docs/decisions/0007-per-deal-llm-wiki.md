# ADR 0007 — Per-deal LLM wiki (Karpathy pattern)

Status: accepted

## Context

Searchers accumulate knowledge about a deal over weeks: source observations, broker conversations, financial data, diligence notes, AI-tool conversations, captured pages, transcripts. Storing all of that as ad-hoc notes loses structure; storing it only in row-shaped DB tables loses the freeform research character.

[Andrej Karpathy's llm-wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) demonstrates a working pattern: markdown the model reads and writes, with `AGENTS.md` as the schema and an LLM maintainer that ingests, queries, and lints.

## Decision

Adopt the Karpathy pattern as Clearbolt's primary per-deal knowledge surface.

Three layers:

1. **Raw sources** (immutable) — every `SourceRecord`, `WorkspaceCapture`, `Transcript` lives in `EvidenceStore` and is never modified by the maintainer.
2. **Wiki** (LLM-maintained markdown) — per-workspace, per-deal directory tree of pages, plus shared cross-deal entity layer (brokers, owners, industries, MSAs).
3. **Schema** (`AGENTS.md`) — tells the maintainer agent how to behave: page categories, naming conventions, required cross-references, lint rules.

Three operations: `wiki-ingest`, `wiki-query`, `wiki-lint` (skills loaded by [`packages/agents`](../../packages/agents/agents.md)).

Layout, operations, and storage backends specified in [`docs/architecture/wiki.md`](../architecture/wiki.md) and [`packages/wiki/agents.md`](../../packages/wiki/agents.md).

## Consequences

- The model becomes a first-class consumer and producer of the workspace's knowledge.
- Compounding effect: answered queries are filed back as new pages so the wiki gets richer over time.
- Two compartmentalisation layers: per-deal wiki pages are workspace-private; cross-workspace shared layer (canonical deals, brokers) is read-only from inside any wiki.
- `AGENTS.md` is the lever: changing maintainer behavior across all workspaces is a schema change, not a code change.
- Storage backed by `WikiStore`: V0 disk via `wiki-fs`, V1+ R2 with content-addressed snapshots via `wiki-r2`.

## Falsifiability criteria

- **Trigger**: wiki maintainer modifies raw sources in `EvidenceStore` (the immutability invariant breaks).
  **Measurement**: V1 — Postgres trigger or contract guard on `EvidenceStore.put` checking for write-after-existence; V0 — disk filesystem audit log.
  **Response**: incident; restore the invariant.
- **Trigger**: wiki ingest takes >60s per source on average.
  **Measurement**: `wiki.maintainer.ingest` span duration telemetry.
  **Response**: profile the maintainer; revisit ingest pipeline (chunking, batching, model choice).
- **Trigger**: 30 days after V1 launch, the wiki shows no measurable accretion (page count or knowledge density per deal stays flat or declines).
  **Measurement**: PostHog dashboard on `wiki.page_viewed`, `wiki.query_asked`, page count per workspace.
  **Response**: revisit maintainer prompts, ingest cadence, and `AGENTS.md` schema; the LLM-wiki pattern is supposed to compound.
- **Trigger**: wiki maintainer produces hallucinated content not traceable to a `SourceRecord`/`Capture`/`Transcript`.
  **Measurement**: `wiki-lint` skill flags pages with claims lacking citation; sampled human review.
  **Response**: tighten maintainer prompt; require citation per claim.
- **Trigger**: searcher feedback rate (`wiki.feedback_given` per `wiki.query_asked`) drops below 10%.
  **Measurement**: PostHog ratio.
  **Response**: revisit query UX or answer quality; the wiki is not earning trust.
