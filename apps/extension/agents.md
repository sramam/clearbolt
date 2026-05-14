# `apps/extension`

> Runtime: browser (Manifest v3 extension). Backend lives in [`packages/capture`](../../packages/capture/agents.md).

The Clearbolt browser extension. **Universal clipper for any page**, including AI tool conversations.

ADR: [`docs/decisions/0004-extension-universal-user-capture.md`](../../docs/decisions/0004-extension-universal-user-capture.md). Pipeline overview: [`docs/architecture/capture.md`](../../docs/architecture/capture.md). Detailed plan: [PLAN.md](PLAN.md).

## Doctrine

The extension is a **per-user, user-initiated personal-productivity tool**. It is not a scraper.

What it does:

- Lets the logged-in Clearbolt user save the current page to their workspace's wiki.
- Works on any page they're authorized to be on.
- Captures the **specific page** they are viewing, with explicit confirmation.
- Pre-fills structured fields via per-host heuristics so the user has less to edit.
- Sends raw HTML + user-confirmed fields to the Clearbolt capture API ([`packages/capture`](../../packages/capture/agents.md)); the **server** validates payloads with **Zod** (see [`packages/capture/agents.md`](../../packages/capture/agents.md)) — the extension stays thin and cannot bypass schema checks.

What it does **not** do:

- No background crawling.
- No pagination automation.
- No bulk capture / "save all pages on this site".
- No cross-user pooling — captures land in the saving user's workspace only.
- No bypass of authentication, paywalls, or technical controls.
- No model training on captured content from private deal networks.

## Where it shines (V2)

- **Axial opportunity pages**: per-user manual capture of deals the user is actively reviewing, into their private workspace CRM.
- **AI tool conversations** (ChatGPT shares, Claude.ai threads, Gemini, Perplexity): save synthesized research from a conversation directly into a deal's wiki.
- **BizBuySell detail pages**: one-click capture supplementing the scraper's automated coverage (useful when the user wants to immediately attach a personal note + thesis fit summary).
- **Broker websites**: capture a listing the user found via direct browsing, attach to an existing canonical deal or create a new one.
- **Generic web pages**: any article, blog post, or news that's relevant — captured as Defuddle-converted markdown into the workspace wiki.

## Phasing

- V0: not started.
- V1: backend `POST /api/captures` shipped on a CF Worker; users can hit it via curl / scripts. The actual extension is **not built** in V1.
- V2: build the extension per [PLAN.md](PLAN.md).

## Why a single extension covers all the surfaces above

The per-host heuristic registry on the server side ([`packages/capture/agents.md`](../../packages/capture/agents.md)) is what specializes per host. The extension itself is generic: serialise visible DOM, ask the registry "what fields would you propose for this URL?", show them in the side panel, send to the API. New hosts add as new heuristic plugins server-side without changing the extension.

## Validation criteria

### Doctrine guardrails (hard rule — these are why ADR 0004 exists)
- **Given** the extension installed in a browser, **when** the user is *not* on a page they have actively opened, **then** no capture is initiated. Coverage: integration (E2E). Test: `apps/extension/tests/no-passive-capture.test.ts` (TBD V2).
- **Given** the extension running on any tab, **when** observed for 24 hours of normal browsing, **then** zero outbound calls to the Clearbolt API occur except in response to an explicit user click. Coverage: integration (E2E). Test: `apps/extension/tests/no-background-network.test.ts` (TBD V2).
- **Given** any captured page, **when** the user reviews the proposed fields, **then** they must explicitly click "save" before any write to the workspace; the side-panel cannot auto-submit. Coverage: integration (E2E). Test: `apps/extension/tests/explicit-confirmation-required.test.ts` (TBD V2).
- **Given** the extension on any host, **when** invoked, **then** it does not bypass authentication, paywalls, robots.txt, or other technical controls; it only serialises what the user's browser would already display. Coverage: code-review checklist + integration. Test: `apps/extension/tests/no-bypass-controls.test.ts` (TBD V2).

### Generic-by-design (host plugins live server-side)
- **Given** a new host added via a server-side `HostHeuristic` plugin, **when** the user visits a page on that host, **then** the extension proposes the new fields without any extension update. Coverage: integration. Test: `apps/extension/tests/server-side-heuristics-applied.test.ts` (TBD V2).

### Side panel UX
- **Given** the side panel is open on a supported host, **when** the user clicks capture, **then** the panel shows: source URL, proposed fields, confidence per field, and an editable summary, before the save button is enabled. Coverage: integration (E2E). Test: `apps/extension/tests/side-panel-fields-rendered.test.ts` (TBD V2).

### Auth
- **Given** an unauthenticated extension, **when** the user clicks capture, **then** the extension prompts for sign-in (better-auth flow); no capture is sent without a valid token. Coverage: integration. Test: `apps/extension/tests/auth-required.test.ts` (TBD V2).

### Manifest v3 hygiene
- **Given** the built extension, **when** scanned, **then** the manifest declares only the permissions actually used at runtime (no broad host permissions). Coverage: lint over `manifest.json`. Test: `apps/extension/tests/manifest-min-permissions.test.ts` (TBD V2).

### Cross-link
- ADR: [`docs/decisions/0004-extension-universal-user-capture.md`](../../docs/decisions/0004-extension-universal-user-capture.md).
- Backend pipeline + heuristic guarantees: [`packages/capture`](../../packages/capture/agents.md) validation criteria.
- Architecture: [`docs/architecture/capture.md`](../../docs/architecture/capture.md).
- Detailed plan: [PLAN.md](PLAN.md).
