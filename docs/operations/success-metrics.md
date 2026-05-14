# Success metrics

Metrics to know whether the product is working, not just shipping.

## Sourcing quality

- New unique deals surfaced per workspace per week.
- Duplicate-merge rate and false-merge rate.
- Adapter freshness (median minutes since last successful run).

## Searcher engagement

- Weekly active workspaces.
- Deals reviewed / liked / disliked / passed per active week.
- Saved searches per workspace and recurring-run cadence.

## Pipeline outcomes

- Deals advanced to `contacted`, `reviewing`, `diligence`, or beyond.
- Median time from new match to first action.
- Outreach reply rate (V2+).

## Wiki

- Wiki pages per workspace per month.
- Wiki query satisfaction (user re-asks soon after = unsatisfied).
- Wiki lint catches per week (contradictions, stale claims, orphans).

## Trust and reliability

- Adapter health SLA hit rate.
- AI eval pass rates per task and version.
- Cost per workspace per active week.
- Cross-tenant test suite pass rate (must always be 100%).

## V1 north-star (`TODO`)

Pick one of:

- New unique deals surfaced per workspace per week (sourcing).
- Deals advanced from `new` to `reviewing` per workspace per week (engagement + sourcing combined).
- Active wiki interactions per workspace per week (depth of use).

Plus 2-3 guardrail metrics to watch alongside it.

## Validation criteria

This doc names the metrics; the validation criteria say which thresholds matter and how they are measured.

### Functional
- **Given** a V1 production deployment running for 4 weeks, **when** the dashboard renders, **then** every metric in this doc has at least one data point. Coverage: smoke (PostHog + VM dashboards). Test: `scripts/metrics-coverage.mjs` (TBD V1).
- **Given** the cross-tenant test suite, **when** any release runs CI, **then** pass rate is **100%** (the only metric with a hard floor). Coverage: integration. Test: `apps/web/tests/tenant-isolation/*.test.ts` (TBD V1).

### Sourcing thresholds
- **Given** a production workspace with active saved searches, **when** measured weekly, **then** **new unique deals surfaced per workspace** ≥ 5 / week (median across active workspaces). Coverage: smoke (PostHog query). Response if breached: investigate adapter health, freshness, or saved-search criteria too narrow.
- **Given** the dedup pipeline running for 30 days on real data, **when** measured, **then** **false-merge rate** (auto-merged pairs that turned out to be different deals) ≤ 1%. Coverage: golden-set + sampled human review. Response if breached: raise auto-merge threshold; more pairs to review queue.
- **Given** any active adapter, **when** measured, **then** **freshness median minutes since last successful run** ≤ 60. Coverage: smoke (VM `clearbolt_adapter_freshness_seconds`). Response: trigger adapter health investigation.

### Engagement thresholds
- **Given** an active workspace (≥ 1 saved search, ≥ 1 user action in last 7 days), **when** measured weekly, **then** **deals reviewed per active workspace** ≥ 10 / week. Coverage: smoke. Response if breached: check ranking quality, surface design.

### Pipeline thresholds
- **Given** an active workspace, **when** measured monthly, **then** **median time from new match to first action** ≤ 48 hours. Coverage: smoke. Response: check notification cadence; check digest UX.

### Wiki thresholds
- **Given** an active workspace, **when** measured monthly, **then** **wiki pages per workspace per month** grows over time (positive slope on rolling 90-day average). Coverage: smoke. Triggers ADR 0007 falsifiability if breached for 30 days.
- **Given** any wiki query, **when** the user does not re-ask within 1 hour, **then** the query is recorded as **satisfied**; satisfaction rate ≥ 80%. Coverage: smoke. Response if breached: improve answer quality or query UX.

### Trust thresholds
- **Given** the AI eval regression suite, **when** it runs against any release, **then** per-task pass rate ≥ baseline minus configurable drift tolerance (default 5%). Coverage: golden-set + CI gate. Test: `services/evals/tests/regression-suite.test.ts` (TBD V2).
- **Given** any V1+ release, **when** measured, **then** cross-tenant test suite pass rate is exactly **100%** (no exceptions). Coverage: CI gate. Test: `apps/web/tests/tenant-isolation/*.test.ts`.

### North-star (selected at V1 launch)
- **Given** the chosen north-star, **when** the V1 launch dashboard renders, **then** the metric is plotted weekly with a clear trendline; if it goes flat or down for 3 consecutive weeks, the team revisits product priorities. Coverage: smoke. Response: weekly review meeting.
