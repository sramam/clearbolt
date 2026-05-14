# Listing Feedback and Personalization

Searchers should be able to react to specific listings and have those reactions improve future results in their workspace.

## Feedback types

- `like`: this looks relevant or directionally interesting.
- `dislike`: this is not relevant; capture optional reason.
- `save` / `watch`: keep tracking this listing or canonical deal.
- `pass`: intentionally exclude from active workflow; capture optional reason.
- `advance`: moved to outreach, review, diligence, or another pipeline stage.
- `snooze`: temporarily suppress until a date or condition (e.g. "remind me when price drops").
- `hide`: permanently hide from this workspace's results without recording a reason.
- `mute_broker` / `mute_source` / `mute_industry`: workspace-level filters that suppress whole categories.

## Scoping rules

Feedback is tied to the workspace and user, plus the canonical deal or business it targets. It must not change the global canonical record except through aggregate, privacy-preserving product analytics if explicitly designed later.

This is the "shared cache, private workspaces" principle in action ([principles.md](principles.md) #5, #6). Two searchers can like the same listing, dislike the same listing, hide it, and snooze it without leaking signals across workspaces.

## Personalization flow

1. Retrieve candidates from the shared cache using structured filters, lexical search, and (V1+) vector search.
2. Apply workspace constraints: saved search criteria, hidden/passed listings, geography, financial profile, market definition, and pipeline state.
3. Re-rank with workspace signals: likes, dislikes, saves, passes, advanced deals, and feedback reasons.
4. Return an explanation that distinguishes global facts from workspace-specific preference effects.

Do not write user-specific preferences back into shared listing quality.

## Open questions

`TODO:` Define `ListingFeedback`, feedback reasons, decay rules, mute scopes, snooze policy, and how feedback affects ranking.

`TODO:` Decide whether users can reset or export their ranking profile.

## Related

- Data model: [../architecture/data-model.md](../architecture/data-model.md) — `WorkspaceFeedback`, `WorkspaceRankingProfile`.
- Ranking: see "Deal Ranking and Purchase Fit" in [surfaces.md](surfaces.md).

## Validation criteria

Feedback drives both UX (the user's loop) and personalization (the model's loop). Validation covers correctness, isolation, and signal quality.

### Functional
- **Given** any feedback type listed above, **when** the user records it, **then** a `WorkspaceFeedback` row is written with `workspaceId`, `userId`, `targetType` (deal | business), `targetId`, `feedbackType`, optional `reason`, and `createdAt`. Coverage: integration. Test: `services/feedback/tests/feedback-row-shape.test.ts` (TBD V1).
- **Given** a `mute_broker` / `mute_source` / `mute_industry` action, **when** subsequent searches run in that workspace, **then** results matching the muted scope are suppressed and the count of suppressed results is shown ("X hidden by your filters"). Coverage: integration. Test: `apps/web/tests/mute-scope-applied.test.ts` (TBD V1).
- **Given** a `snooze` with a date condition, **when** the date passes, **then** the listing returns to the workspace's results with a "snooze ended" indicator. Coverage: integration. Test: `services/feedback/tests/snooze-resume.test.ts` (TBD V1).

### Tenant isolation (hard rule)
- **Given** workspace A's feedback on a canonical deal, **when** workspace B queries the same deal, **then** workspace B's ranking is unaffected by workspace A's feedback. Coverage: integration (cross-tenant test suite). Test: `apps/web/tests/tenant-isolation/feedback-isolated.test.ts` (TBD V1). Pass rate must be 100%.
- **Given** any aggregate analytics over feedback (V2+), **when** computed, **then** results are de-identified (no per-workspace attribution leaves the workspace boundary). Coverage: integration. Test: `services/analytics/tests/feedback-aggregates-deidentified.test.ts` (TBD V2).

### Personalization signal quality
- **Given** a workspace with ≥ 50 feedback actions, **when** an A/B test compares its personalized ranking against a workspace-blind baseline, **then** liked-deal precision improves by a measurable margin (target ≥ 5pp). Coverage: golden-set + A/B (V2). Test: `services/ranking/tests/personalization-lift.test.ts` (TBD V2).
- **Given** the personalization flow, **when** a result is ranked above its baseline position, **then** the explanation distinguishes "global facts" from "your preferences" (per the doc's explicit requirement). Coverage: integration. Test: `apps/web/tests/ranking-explanation-separates-global-vs-personal.test.ts` (TBD V2).

### Decay / freshness
- **Given** a feedback row older than the configured decay window (TBD V2), **when** ranking is computed, **then** the signal weight is decayed per the documented schedule. Coverage: integration. Test: `services/ranking/tests/feedback-decay.test.ts` (TBD V2).

### Privacy
- **Given** a workspace owner, **when** they request a ranking-profile export or reset, **then** the export contains all feedback and the reset deletes all feedback for that workspace within 24 hours. Coverage: integration. Test: `services/feedback/tests/export-and-reset.test.ts` (TBD V2). Resolves the open TODO above.

### Cross-link
- Tenant isolation cross-suite: [../architecture/security.md](../architecture/security.md).
- Ranking signals: [surfaces.md](surfaces.md) "Deal Ranking and Purchase Fit" validation criteria.
