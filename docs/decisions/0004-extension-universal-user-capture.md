# ADR 0004 — Browser extension is a universal user-initiated clipper

Status: accepted

## Context

Some valuable sources for ETA searchers (Axial, gated broker portals, AI conversations on ChatGPT / Claude / Gemini / Perplexity) cannot or should not be ingested by automated scrapers. They're behind paid memberships, ToS-restricted, or just personal context.

Searchers still need a frictionless way to bring those into Clearbolt's per-deal wiki.

## Decision

Build a **per-user, user-initiated browser extension** that captures **any** page the user is actively viewing. Doctrine:

- User-initiated only (one click per capture).
- Per-user (captures land in the saving user's workspace; never cross-pooled).
- Explicit confirmation of fields before save.
- Source URL preserved.
- Both raw HTML and converted markdown stored.
- AI extraction proposes structured fields; user reviews and confirms.
- No background crawling, no pagination automation, no bulk capture.
- No bypass of authentication, paywalls, or technical controls.
- No model training on captured content from private deal networks.

Per-host heuristic registry on the server side ([`packages/capture`](../../packages/capture/agents.md)) specializes extraction per host: Axial, ChatGPT, Claude.ai, Gemini, Perplexity, BizBuySell detail, generic fallback.

## Consequences

- Axial captures land in the user's private workspace wiki, never as a shared dataset.
- ChatGPT / Claude / Gemini / Perplexity conversations become first-class research artifacts in the per-deal wiki.
- The extension is one piece of UX; new hosts add as server-side heuristic plugins, not extension changes.
- ToS / legal posture is defensible: the user is acting on their own behalf with explicit intent.
- Captures and shared listings stay separate by design — no risk that aggregating user captures starts to look like commercial exploitation of a private network.

## Falsifiability criteria

- **Trigger**: extension implements pagination automation, bulk capture, background crawling, or any non-user-initiated network call to a tracked host.
  **Measurement**: extension code review at every release + manifest permissions audit.
  **Response**: incident; ToS posture is compromised. Remove the feature.
- **Trigger**: captures from private deal networks (Axial, gated portals, NDA-bound documents) get aggregated into the shared listing cache.
  **Measurement**: data-flow audit on the capture pipeline + lint that `WorkspaceCapture` records do not flow into `CanonicalDeal` writes.
  **Response**: incident; reverse the leak; post-mortem.
- **Trigger**: more than 1% of captures per week are bulk imports (>20 captures from same user in <5 minutes).
  **Measurement**: telemetry on `capture.created` events.
  **Response**: rate-limit the per-user capture endpoint; investigate whether a user is using the extension as a bulk scraper.
- **Trigger**: a captured page from a private deal network is used as training data for any AI feature.
  **Measurement**: data lineage audit on AI training jobs.
  **Response**: incident; remove the data; tighten policy.
- **Trigger**: legal complaint or DMCA-style takedown received from a host whose page was captured.
  **Measurement**: legal inbox.
  **Response**: revisit the host's heuristic and the surrounding doctrine; potentially add the host to a deny-list.
