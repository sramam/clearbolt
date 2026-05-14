# ADR 0008 — Default HTML-to-Markdown library: Defuddle

Status: accepted

## Context

The universal clipper ([`packages/capture`](../../packages/capture/agents.md)) and the wiki maintainer ([`packages/wiki`](../../packages/wiki/agents.md)) both convert HTML to Markdown. Quality matters because the LLM downstream reads the markdown as input, and bad conversion (broken tables, lost code blocks, dropped lists, mangled headings) becomes worse extraction.

Surveyed:

- **Defuddle** — recommended in Karpathy's `llm-wiki` gist; aggressive boilerplate stripping; preserves semantic structure well.
- **Readability + Turndown** — well-known combo (Mozilla Readability for content extraction, Turndown for HTML-to-MD). Solid; older.
- **Jina Reader** — hosted API; very high quality; per-call cost.
- **Custom** — full control; significant maintenance.

## Decision

V0/V1 default: **Defuddle**.

Rationale:

- Strong recommendation from working LLM-wiki practitioners (Karpathy gist).
- Open source, no per-call cost.
- Pluggable per the `HtmlToMarkdown` contract — Readability+Turndown, Jina Reader, custom can swap in per-page or per-host without consumer changes.

## Consequences

- Captures from arbitrary pages (including AI-tool conversations) get high-quality markdown by default.
- The `HtmlToMarkdown` contract's pluggability means we can fall back to Jina Reader for difficult pages on a per-host basis.
- Defuddle becomes a runtime dep on both CF Workers and Fly Node — must verify it bundles cleanly for Workers.

## Falsifiability criteria

- **Trigger**: Defuddle does not bundle for CF Workers (size limit, missing API, or runtime error on cold start).
  **Measurement**: build pipeline; Workers smoke test on every release.
  **Response**: switch default to Readability+Turndown for the Workers runtime; per-runtime override in `bindHtmlToMarkdown()`.
- **Trigger**: HTML-to-MD quality drops below the per-host fixture threshold (markdown-vs-expected diff exceeds 10% on the golden set).
  **Measurement**: `packages/capture/tests/fixtures/<host>/expected.md` regression run.
  **Response**: per-host backend override (Readability+Turndown or Jina Reader for difficult hosts), or contribute upstream fix to Defuddle.
- **Trigger**: Defuddle is unmaintained for >6 months (no commits, no responses to issues).
  **Measurement**: monthly upstream check.
  **Response**: revisit; consider switching default to a more active library.
- **Trigger**: a captured page from an AI-tool conversation (ChatGPT / Claude / Gemini / Perplexity) loses code blocks, lists, or tables in the markdown output.
  **Measurement**: per-host fixture tests for each AI-tool host.
  **Response**: per-host override; this category is high-value and must round-trip cleanly.
