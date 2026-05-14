# `packages/capture`

> Runtime: **both**. POST endpoint on CF Worker; processing on Fly.

The universal clipper backend. Handles `POST /api/captures` plus the asynchronous processing pipeline.

**Zod** validates versioned capture payloads at the Worker edge (`CaptureRequest` / `CaptureResponse` shapes) and again after `capture-extract` before writing canonical-adjacent fields, so parser drift and bad client JSON surface as typed errors instead of silent corruption.

Cross-cuts [`docs/architecture/capture.md`](../../docs/architecture/capture.md). ADR: [`docs/decisions/0004-extension-universal-user-capture.md`](../../docs/decisions/0004-extension-universal-user-capture.md). Browser-side doctrine in [`apps/extension/agents.md`](../../apps/extension/agents.md).

## Pieces

### `POST /api/captures` handler (CF Worker)

```ts
// runs on CF Workers
async function handleCapture(req: Request, env: Env): Promise<Response> {
  // 1. validate better-auth token; extract { userId, workspaceId }
  // 2. parse body: { sourceUrl, host, rawHtml, hostHeuristicVersion, suggestedFields }
  // 3. write rawHtml to R2 at workspaces/<workspaceId>/captures/<captureId>/raw.html
  // 4. insert WorkspaceCapture pending row (Neon HTTP driver)
  // 5. enqueue capture-process job (pg-boss)
  // 6. return { captureId }
}
```

### `capture-process` worker (Fly)

Picks up jobs from pg-boss; for each job:

1. Read raw HTML from R2.
2. Convert to markdown via `HtmlToMarkdown` (V0 default Defuddle; pluggable per [`docs/architecture/contracts.md`](../../docs/architecture/contracts.md)).
3. Store markdown alongside raw HTML in R2 (`workspaces/<workspaceId>/captures/<captureId>/page.md`).
4. Run `capture-extract` skill via [`packages/agents`](../agents/agents.md) to produce structured fields and a summary.
5. Call `wikiUpsertPage({ workspaceId, target, payload })` (a tool exposed by the wiki maintainer; see [`packages/wiki/agents.md`](../wiki/agents.md)).
6. Update `WorkspaceCapture` row to `processed` with extracted fields, summary, R2 keys, optional `attachToCanonicalDealId`.

### `HtmlToMarkdown` contract

```ts
interface HtmlToMarkdown {
  convert(rawHtml: string, opts?: { url?: string; preserveTables?: boolean }): Promise<string>;
}
```

V0 default: [Defuddle](https://github.com/karpathy/llm-wiki) (referenced by Karpathy's gist as the recommended HTML-to-MD tool — ADR [`0008-html-to-markdown-defuddle.md`](../../docs/decisions/0008-html-to-markdown-defuddle.md)). Pluggable: Readability + Turndown, Jina Reader, custom.

### `HostHeuristic` registry

```ts
interface HostHeuristic {
  hostMatchers: (string | RegExp)[];
  extract(rawHtml: string, url: string): Promise<{
    suggestedFields: Record<string, unknown>;
    summary?: string;
    confidenceHints?: Record<string, 'low' | 'medium' | 'high'>;
  }>;
}

const heuristics = registerHeuristics([
  axialHeuristic,
  chatGptHeuristic,
  claudeAiHeuristic,
  geminiHeuristic,
  perplexityHeuristic,
  bizBuySellDetailHeuristic,
  genericFallbackHeuristic,
]);
```

V1 heuristics shipped:

- **Axial** — opportunity-page extractor; per-user, manual, ToS-respecting.
- **ChatGPT** (`chat.openai.com`, `chatgpt.com/share/...`) — conversation extractor.
- **Claude.ai** — conversation extractor.
- **Gemini** (`gemini.google.com`) — conversation extractor.
- **Perplexity** (`perplexity.ai`) — answer extractor.
- **BizBuySell detail** — fields the BizBuySell adapter would extract, but for a single page captured by a user.
- **Generic fallback** — Defuddle markdown + visible-text proposal.

New hosts add as plugin entries — no core change.

## Doctrine guardrails

ADR-codified:

- User-initiated only; no background crawl, no pagination, no bulk import.
- Per-user; never aggregated cross-workspace without explicit consent.
- Source URL preserved; both raw HTML and converted markdown stored.
- AI proposes structured fields; user reviews and confirms before save.
- No bypass of authentication, paywalls, or technical controls.

## Phasing

- V0: not implemented.
- V1: full pipeline (CF Worker endpoint + Fly processing worker + heuristic registry + wiki maintainer integration).
- V2: the actual browser extension build ([`apps/extension/PLAN.md`](../../apps/extension/PLAN.md)).

## Validation criteria

### Endpoint contract
- **Given** `POST /api/captures` with a valid better-auth token, **when** the request body has `sourceUrl`, `host`, `rawHtml`, **then** the handler returns `{ captureId }` and the client can poll `GET /api/captures/:captureId` for status. Coverage: integration. Test: `packages/capture/tests/post-captures-happy-path.test.ts` (TBD V1).
- **Given** `POST /api/captures` with a body that fails the versioned **Zod** `CaptureRequest` schema, **when** invoked, **then** the handler returns 400 with a structured error and no R2 / Neon writes occur. Coverage: integration. Test: `packages/capture/tests/post-captures-schema-reject.test.ts` (TBD V1).
- **Given** `POST /api/captures` without auth, **when** invoked, **then** the request returns 401 and no R2 / Neon writes occur. Coverage: integration. Test: `packages/capture/tests/post-captures-unauth.test.ts` (TBD V1).
- **Given** the same `sourceUrl + workspaceId` posted twice within a configured de-dup window, **when** processed, **then** only one `WorkspaceCapture` row is created (idempotent). Coverage: integration. Test: `packages/capture/tests/duplicate-post-deduped.test.ts` (TBD V1).

### Doctrine guardrails (hard rule)
- **Given** the capture pipeline, **when** any background process runs, **then** no host is fetched without an explicit user-initiated capture (no crawling, no pagination, no bulk import). Coverage: integration. Test: `packages/capture/tests/no-background-fetch.test.ts` (TBD V1). Cross-link to ADR 0004 falsifiability.
- **Given** any extracted fields, **when** processing completes, **then** the user is required to confirm before any write to canonical/wiki layers; raw HTML and markdown are preserved either way. Coverage: integration. Test: `packages/capture/tests/confirm-before-canonical-write.test.ts` (TBD V1).

### Storage shape
- **Given** any captured page, **when** written, **then** both `workspaces/<workspaceId>/captures/<captureId>/raw.html` and `.../page.md` exist in R2. Coverage: integration. Test: `packages/capture/tests/raw-and-md-both-stored.test.ts` (TBD V1).
- **Given** any capture, **when** read by a non-workspace-member user, **then** the request returns 403. Coverage: integration. Test: `packages/capture/tests/capture-tenant-isolated.test.ts` (TBD V1).

### `HtmlToMarkdown`
- **Given** any `HtmlToMarkdown` backend, **when** the conformance suite runs against the fixture corpus, **then** output meets minimum quality thresholds: text recall ≥ 95%, header structure preserved, no lost links. Coverage: golden-set. Test: `packages/capture/src/conformance/html-to-markdown.suite.ts` (TBD V1).

### `HostHeuristic` registry
- **Given** any host heuristic, **when** matched against its labeled fixture corpus, **then** field extraction precision ≥ 90% and recall ≥ 80% on declared fields. Coverage: golden-set. Test: `packages/capture/tests/heuristic-precision-recall.test.ts` (TBD V1).
- **Given** an unmatched host, **when** processed, **then** the `genericFallbackHeuristic` runs and produces a non-empty markdown + summary. Coverage: integration. Test: `packages/capture/tests/generic-fallback-runs.test.ts` (TBD V1).

### Wiki integration
- **Given** a successfully processed capture, **when** complete, **then** `wikiUpsertPage` is called and the resulting wiki page links back to the capture R2 keys. Coverage: integration. Test: `packages/capture/tests/wiki-page-links-back.test.ts` (TBD V1).

### Cross-link
- ADR: [`docs/decisions/0004-extension-universal-user-capture.md`](../../docs/decisions/0004-extension-universal-user-capture.md), [`0008-html-to-markdown-defuddle.md`](../../docs/decisions/0008-html-to-markdown-defuddle.md).
- Architecture: [`docs/architecture/capture.md`](../../docs/architecture/capture.md).
