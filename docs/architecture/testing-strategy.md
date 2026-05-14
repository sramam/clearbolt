# Testing strategy

How validation criteria become passing tests, and how the test pyramid maps to Clearbolt's pluggable contracts.

Principle: [principles.md §5](principles.md#5-specs-include-validation-criteria-negotiated-before-commit). Spec template: [spec-template.md](spec-template.md). ADR: [0015](../decisions/0015-specs-include-validation-criteria.md).

## The test types

Each criterion in a `## Validation criteria` block is tagged with one of:

| Coverage | What it does | Where it lives | Runs in |
|---|---|---|---|
| `unit` | Black-box test of one function or class against deterministic inputs. No I/O, no real backends. | `packages/<pkg>/tests/*.test.ts` | `pnpm test` |
| `conformance` | Reusable test suite that any implementation of a contract must pass. Lives in the contract package, invoked by every backend package. | `packages/<contract-pkg>/src/conformance/*.suite.ts` | Invoked by each backend's `tests/*.test.ts` |
| `integration` | Multiple packages exercised together against a running backend (disk in V0, real Postgres/R2 in V1+). Slower; tagged `@integration`. | `packages/<pkg>/tests/integration/*.test.ts` | `pnpm test:integration` |
| `golden-set` | Curated input/output fixtures that pin behavior across changes (dedup pairs, parser HTML samples, AI extraction prompts/responses). | `packages/<pkg>/tests/fixtures/` + a runner test | `pnpm test` |
| `property` | Property-based tests via `fast-check`; assert invariants over generated inputs. Used for normalization, key derivation, AIMD math. | `packages/<pkg>/tests/property/*.test.ts` | `pnpm test` |
| `smoke` | One coarse end-to-end test per app surface. Asserts the system runs end-to-end on the happy path. Slow; tagged `@smoke`. | `apps/<app>/tests/*.smoke.test.ts` | `pnpm test:smoke` |
| `manual-review` | Human inspection (UX heuristic, prompt quality). Documented as a checklist in the spec; reviewer signs off in PR description. | n/a | n/a |

Order of preference when writing a new criterion: **conformance > unit > property > integration > golden-set > smoke > manual-review**. Push tests as low in the stack as possible; each `manual-review` criterion is a tax on every release.

## Mapping criterion type to test type

| Criterion shape | First-choice test type |
|---|---|
| "Backend X satisfies contract Y" | conformance |
| "Function f(x) returns y" | unit |
| "Property P holds over all inputs in domain D" | property |
| "Pipeline A → B → C produces output O for fixture F" | golden-set + integration |
| "User-facing command works end-to-end" | smoke |
| "Latency p95 stays under T ms" | smoke + benchmarking script |
| "AI prompt produces structured output of shape S" | golden-set (prompt eval) + manual-review for quality |
| "UX flow feels fast / discoverable / trustworthy" | manual-review (logged as a heuristic in product docs) |

## Conformance suites are first-class

Every contract in `packages/<x>` ships a conformance suite under `packages/<x>/src/conformance/`. The suite exports functions that take a backend factory and run a battery of assertions. Every backend (V0 disk, V1 R2, V1 Neon, V2 Durable Objects, etc.) consumes the suite from its own test file:

```ts
// packages/storage-r2/tests/r2-evidence-store.test.ts
import { runEvidenceStoreConformance } from '@clearbolt/storage/conformance/evidence-store.suite';

runEvidenceStoreConformance(() => makeR2EvidenceStore({ bucket: TEST_BUCKET, ... }));
```

This is what makes "pluggable everything" testable: a backend is interchangeable with another iff it passes the same conformance suite. The contracts inventory ([contracts.md](contracts.md)) names the conformance suite for each contract.

Adding a new backend never adds new conformance assertions — it adds a new test file that invokes the existing suite. If a backend needs a behavior the contract does not currently express, the contract's spec is updated (with new criteria and corresponding suite tests) **before** the backend ships.

## Golden-set tests for AI

AI-touching code (extraction prompts, normalization, ranking, dedup contributors that may eventually use embeddings, wiki maintainer ops) gets a `tests/fixtures/` directory holding curated input/output pairs. The runner test asserts that running the prompt over the fixtures produces the expected structured output.

For prompt eval: each fixture file has `input.md`, `expected.json`, optional `notes.md`. The eval runner records pass/fail per fixture and a summary cost per run. Failures do not fail CI by default (model drift is normal); they update a tracked drift score that, when crossed, opens a "review prompt" PR.

For dedup: `tests/fixtures/known-pairs.ts` lists explicit `merge` / `not-merge` / `borderline` pairs with rationale. Adding a contributor must keep all `merge` pairs above 0.85, all `not-merge` pairs below 0.55, and the `borderline` pairs in `[0.55, 0.85)` until human-review reclassifies them.

## The four-substep loop inside each implementation step

Per principle 5, every implementation step in a phase runs:

1. **Write the spec's `## Validation criteria` section.** If the spec already has one, refine it for what this step adds. Reviewer agrees the criteria are observable.
2. **Write failing tests asserting each criterion.** Use `it.fails` or `.skip` if the implementation does not exist yet. Each criterion gets at least one test; the test name references the criterion id.
3. **Implement until tests are green.** No new behaviors that are not covered by a criterion.
4. **Lint + typecheck + commit.** Commit message references which criteria are now covered. PR description lists net-new criteria + net-new tests.

## The lint:specs gate

`scripts/lint-specs.mjs` walks every markdown file under `docs/`, `packages/`, `apps/`, and the root. It enforces:

- Every `agents.md` has a `## Validation criteria` section.
- Every file in `docs/architecture/`, `docs/phases/`, `docs/operations/` (except `principles.md` itself) has a `## Validation criteria` section.
- Every file in `docs/decisions/` (every ADR) has either `## Falsifiability criteria` or, if explicitly marked `Status: Superseded`, a pointer to its successor.
- Every contract listed in `contracts.md` has a `Conformance suite` cell pointing to a real file path.

In V0 the gate runs as `pnpm lint:specs` and prints a report; not yet a CI hard fail. In V1, the gate becomes part of the pre-commit hook and a required CI check.

## What testing does not solve

This strategy buys observability into spec compliance. It does not buy us:

- **Whether the spec is the right spec.** That is product/architecture review.
- **Whether the validation criteria capture the user-visible value.** That is the discipline of writing criteria that map to user-meaningful outcomes, not implementation internals.
- **Whether the AI components produce good answers, not just structured ones.** Golden-sets pin shape; quality is judged by humans (manual-review) until we have enough labeled data to build automated quality scores.

When in doubt, push as much as possible to conformance + unit + property + golden-set, and keep manual-review reserved for irreducibly human judgments.

## Validation criteria

This strategy doc itself follows principle 5.

### Functional
- **Given** any contract listed in [contracts.md](contracts.md), **when** `pnpm lint:specs` runs, **then** the contract has a `Conformance suite` cell pointing to a real file path. Coverage: smoke (lint-specs script). Test: `scripts/lint-specs.mjs::contract_has_conformance_suite_cell` (TBD V1).
- **Given** any new backend package added to the workspace, **when** its tests run, **then** it invokes the corresponding conformance suite from its contract package. Coverage: smoke (lint-specs). Test: `scripts/lint-specs.mjs::backend_invokes_conformance_suite` (TBD V1).
- **Given** any markdown spec file, **when** `pnpm lint:specs` runs, **then** the file has either `## Validation criteria` or (for ADRs) `## Falsifiability criteria`. Coverage: smoke. Test: `scripts/lint-specs.mjs::spec_has_criteria_section` (V0 dry-run; V1 CI gate).

### Non-functional
- **Given** a healthy V1 codebase, **when** counting passing tests, **then** every criterion in every `## Validation criteria` section is referenced by at least one test (via the `Test: <path>` annotation). Coverage: smoke. Test: `scripts/lint-specs.mjs::every_criterion_has_test` (TBD V1.5; requires criteria to consistently include `Test:` lines, which we backfill incrementally).

### Failure modes
- **Given** a spec doc with a `## Validation criteria` section that contains zero `- **Given**` lines, **when** `pnpm lint:specs --strict` runs, **then** it fails. Coverage: smoke. Test: `scripts/lint-specs.mjs::criteria_section_must_contain_at_least_one_assertion` (V1).

## Open questions

- [ ] When (V1.5? V2?) do we promote `pnpm lint:specs` from advisory to a required CI gate? Resolved when we have one full V0→V1 cycle of spec discipline and a sense for false-positive rate.
- [ ] How do we test the "negotiation" step itself — i.e., that criteria are co-designed with specs rather than retrofitted? Possible answer: PR template requires both spec and criteria edits in the same commit. Resolved when we adopt the PR template at V1.

## ADRs

- [0015 — Specs include validation criteria, negotiated before commit](../decisions/0015-specs-include-validation-criteria.md)
- [0006 — Pluggable everything](../decisions/0006-pluggable-everything.md) (conformance suites are how this principle is enforced)
