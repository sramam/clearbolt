# Known failure modes

Catalog of failures we expect and the mitigations baked into the design.

- **Akamai/JS challenges**: per-domain `browser_fallback`, conservative concurrency, identifiable user-agent, AIA-fixed TLS, AIMD throttling, `needsBrowser` persistence, optional Apify external-actor escape hatch ([ADR 0013](../decisions/0013-apify-as-optional-fallback.md)).
- **Adapter parser drift**: canary fixtures, schema-drift alerts, freshness badges in UI, replay from preserved R2 evidence.
- **Silent dedup misses or false merges**: human-review queue, conflict tracking, ability to split a canonical record, sub-threshold `MergeCandidate`s persisted for V1 vector pass to re-evaluate.
- **AI hallucinated facts**: structured outputs only, source-snippet provenance required, eval regression suite, per-field confidence stamped at extraction time.
- **Wiki maintainer rewriting good prose**: maintainer version stamped per page; pages flagged "user-edited" are never auto-overwritten without review; lint pass writes diffs into a queue rather than directly when confidence is low.
- **Outreach deliverability collapse**: warmed sending domains, suppression lists, bounce/opt-out enforcement, sending caps.
- **Cost blowups**: per-workspace/per-feature budgets, anomaly alerts, prompt-cache discipline, AI Gateway in front of every model call.
- **Tenant leakage**: workspace-scoped queries enforced at the data-access layer (not just the API edge); tested with cross-tenant fixtures; R2 keys carry workspace prefix; better-auth tokens carry workspace claim.
- **Stale or zombie listings**: lifecycle states, freshness decay, surfaced rather than hidden.
- **Single-source dependence**: keep multiple adapters healthy; degrade gracefully when one is down.
- **Vendor drift** (Apify actor changes, model deprecations, Defuddle API changes): treat as integrations behind interfaces; replace without rewriting domain layer.
- **Cross-cloud latency** (CF -> Fly hops): minimize via `deployment.md` boundary contract — CF reads from Neon directly, CF writes via job queue, Fly never calls CF.
- **Whisper-local quality on hard audio**: tier escalation to Gemini and then OpenAI Whisper API per [transcripts.md](../architecture/transcripts.md); quality gate prevents silent low-quality transcripts.
- **Capture extracts wrong field on a private network page**: per-host heuristic versions; user must confirm fields before save; raw HTML preserved for re-extraction with a better extractor.

`TODO:` Maintain this list as new failure modes appear in real ops.

## Validation criteria

Each failure mode in the catalog must have at least one of: a regression test, a runbook, or an alert. The system fails *visibly*; failures we do not detect are the worst kind.

### Functional
- **Given** any failure mode listed above, **when** an audit pass runs, **then** the entry has at least one of: a linked regression test path, a runbook link, or an alert/metric name. Coverage: lint. Test: `scripts/lint-specs.mjs::failure_mode_has_mitigation_link` (TBD V1).
- **Given** the Akamai mitigation chain, **when** an HTTP-first fetch fails with a 403/CAPTCHA on a domain marked `needsBrowser=false`, **then** the adapter automatically promotes the domain to `needsBrowser=true` and retries via Playwright on the next run. Coverage: integration. Test: `packages/scraper/tests/needs-browser-promotion.test.ts` (TBD V0).
- **Given** the dedup auto-merge pipeline, **when** a previously auto-merged pair is later split by a user, **then** a `MergeCandidate` row records the disagreement and the scorer's threshold is downweighted on the originating signal. Coverage: integration. Test: `packages/dedup/tests/split-feedback-loop.test.ts` (TBD V1).
- **Given** any AI-extracted field, **when** stored, **then** the row carries `sourceSnippet` provenance and a `confidence` score; no claim is shown in UI without provenance. Coverage: integration. Test: `apps/web/tests/no-claim-without-provenance.test.ts` (TBD V1).
- **Given** the wiki maintainer, **when** a page is flagged `userEdited=true`, **then** the maintainer never overwrites prose; lint diffs go to a review queue. Coverage: integration. Test: `services/wiki-maintainer/tests/respect-user-edit.test.ts` (TBD V1).
- **Given** any data-access call, **when** it queries a workspace-scoped table, **then** `workspaceId` is part of the where clause; cross-tenant fixtures verify isolation. Coverage: integration. Test: `apps/web/tests/tenant-isolation/*.test.ts` (TBD V1).
- **Given** a paid-transcribe fallback, **when** it fires for a workspace at > 3× the 7-day average rate, **then** an anomaly alert fires. Coverage: integration. Test: `services/transcribe/tests/paid-fallback-anomaly.test.ts` (TBD V1.5).
- **Given** any captured page from a private network, **when** AI extraction completes, **then** the user sees a confirmation UI before save; raw HTML is preserved either way. Coverage: integration. Test: `apps/extension/tests/confirm-before-save.test.ts` (TBD V1).

### Drift / freshness
- **Given** any adapter with canary fixtures, **when** the canary fails for 2 consecutive runs, **then** a parser-drift alert fires and the adapter is marked degraded in the UI. Coverage: smoke. Test: `services/adapter-canary/tests/two-strikes-degrade.test.ts` (TBD V1).
- **Given** any deal record, **when** its evidence is older than its lifecycle-state freshness threshold, **then** the UI shows a `stale` badge; the record is *not* hidden. Coverage: integration. Test: `apps/web/tests/stale-badge.test.ts` (TBD V1).

### Cost
- **Given** any workspace, **when** monthly AI cost exceeds budget, **then** further model calls are rejected (see [cost-budgets.md](cost-budgets.md) validation criteria). Cross-link.

### Catalog discipline
- **Given** any new production incident, **when** the post-mortem is filed, **then** either an existing failure-mode entry is referenced or a new entry is added in the same PR. Coverage: PR review.
