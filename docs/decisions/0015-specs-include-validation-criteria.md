# ADR 0015 — Specs include validation criteria, negotiated before commit

Status: accepted

## Context

Through V0 planning we accumulated 85 markdown spec files: 1 root `agents.md`, 26 package/app `agents.md`, 14 ADRs, 14 architecture design docs, 5 operations docs, 5 product docs, 4 phase docs, plus an open-questions log. Most describe **what** the system does without making the criteria for "done" observable. Some implicitly assume tests will be written later; some assume the principle of the matter is so clear no test is required; some are aspirational and no test is yet possible.

This pattern is fine in a one-person sketch and lethal in a multi-agent codebase. When implementation lags spec by weeks, ambiguity hardens into accidental behavior, and "is this a bug or a feature?" loses meaning. Worse, when AI agents (cursor, codex, our own harness) implement against vague specs, they invent plausible behavior that is hard to challenge after the fact.

We need spec discipline that:

1. Forces the spec author to articulate observable success criteria as part of the spec, not as a downstream artifact.
2. Forces co-design: ambiguous specs are surfaced when their criteria are weak.
3. Scales without slowing us down: the discipline lives in the markdown files we already write, not in a separate test plan document.
4. Is mechanically checkable: a script can detect specs that violate the discipline.

## Decision

Every spec — package `agents.md`, ADR, contract definition, design doc, phase doc, operations doc — must include a `## Validation criteria` section (or, for ADRs, `## Falsifiability criteria`) listing concrete, observable assertions.

Specs and their validation criteria are reviewed together. A spec without validation criteria is not committed; a spec whose criteria are not observable from outside the implementation is sent back for negotiation.

Implementation order inside any package step is fixed: **validation criteria → failing tests for those criteria → implementation → tests green → commit**. Commit messages reference the criteria covered.

The canonical shape lives in [spec-template.md](../architecture/spec-template.md). The criterion-to-test mapping lives in [testing-strategy.md](../architecture/testing-strategy.md). A `pnpm lint:specs` script enforces presence of the section; in V0 it is a dry-run, in V1+ it is a pre-commit hook + required CI check.

This becomes the 5th architectural principle, recorded in [principles.md §5](../architecture/principles.md#5-specs-include-validation-criteria-negotiated-before-commit).

## Consequences

- Spec authoring takes longer. Reviewers spend time on criteria as much as on prose. Net cost: ~30% more time per spec.
- Specs are testable. New backends pass conformance suites; new pipelines are validated against golden-set fixtures.
- Multi-agent work converges. When two agents (or one agent + one human) implement against the same spec, they implement against the same criteria.
- ADRs become falsifiable. We can revisit decisions when their kill-switch conditions trigger, instead of carrying lossy "still seems right" judgments forever.
- Backfill cost: ~71 existing markdown files need a `## Validation criteria` section added retroactively. Done as Step 0b of the V0 walking skeleton plan.
- Spec changes that loosen criteria require explicit reviewer sign-off. Tightening criteria is fine; loosening them is a decision.

## Alternatives considered

- **Test-driven development as a culture norm, no spec-side discipline.** Rejected: works at small team scale, breaks down with multiple agents and async work where the test author and spec author may be different and weeks apart.
- **Separate test-plan documents.** Rejected: drifts from the spec, dies in the corner of the repo no one reads.
- **Going-forward only (no backfill).** Rejected: the user explicitly chose full backfill. Going-forward leaves V2+ packages in the same vague state and creates a two-tier doc culture.
- **Tighten only contract specs; leave ADRs/product docs informal.** Rejected: ADRs need falsifiability for the same reason — "is this still the right call?" needs an observable answer, not a vibe.

## Falsifiability criteria

This ADR itself must be falsifiable per its own rule.

- **Trigger**: 30 days after V1 cutover, the rate of "spec-vs-implementation drift" PRs (PRs that update a spec to match what was actually built) exceeds 1 per 10 implementation PRs.
  **Measurement**: count PR labels `spec-drift-fix` over a rolling 30-day window vs total `feat:` / `fix:` PRs.
  **Response**: revisit the spec workflow; the discipline is not catching ambiguity at the right moment.
- **Trigger**: average time from "spec PR opened" to "spec PR merged" exceeds 1 week for non-architectural specs.
  **Measurement**: GitHub PR analytics filtered to `docs/architecture`, `docs/phases`, `packages/*/agents.md`.
  **Response**: simplify the template; the bar is too high for the value delivered.
- **Trigger**: more than 25% of `## Validation criteria` blocks contain only TBD entries 60 days after the spec is committed.
  **Measurement**: `pnpm lint:specs --report-tbd-rate`.
  **Response**: criteria are being written but not implemented; revisit estimation, scope, or staffing.
- **Trigger**: a spec is committed that explicitly asserts a behavior the validation criteria do not cover (i.e., the prose says X happens, no criterion observes X).
  **Measurement**: caught in PR review; if it slips through, found in incident retros.
  **Response**: tighten the PR template / lint to detect prose-vs-criteria gaps; consider a third linter rule that scans `## Behavior` for `must`/`should` and flags unmatched assertions.

If the first or fourth trigger fires repeatedly, this ADR is failing and should be revisited or superseded.

## References

- [principles.md §5](../architecture/principles.md#5-specs-include-validation-criteria-negotiated-before-commit)
- [spec-template.md](../architecture/spec-template.md)
- [testing-strategy.md](../architecture/testing-strategy.md)
- [ADR 0006 — Pluggable everything](0006-pluggable-everything.md) (conformance suites are how Pluggable Everything is operationalized; this ADR generalizes the same pattern to all specs)
