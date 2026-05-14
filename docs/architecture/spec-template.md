# Spec template

The canonical shape every new spec uses. Drop this skeleton into a fresh `agents.md`, ADR, or design doc and fill in the sections. A spec without a complete `## Validation criteria` section is not a spec — it is a sketch — and is not committed.

Principle: [principles.md §5](principles.md#5-specs-include-validation-criteria-negotiated-before-commit). ADR: [0015](../decisions/0015-specs-include-validation-criteria.md). Strategy: [testing-strategy.md](testing-strategy.md).

## When to use which variant

| Spec kind | Variant | Section name |
|---|---|---|
| Package `agents.md`, contract, design doc, phase doc | Standard | `## Validation criteria` |
| ADR | Falsifiability | `## Falsifiability criteria` |
| Operations doc | Thresholds | `## Validation criteria` (with measurable thresholds) |
| Product doc | Heuristics | `## Validation criteria` (funnel rates, NPS, qualitative review notes) |

## Standard template

```markdown
# [Spec name]

## Purpose
What this spec describes and why it exists. One paragraph. Link to the product or architectural concern it serves.

## Behavior
What must be true. Inputs, outputs, invariants, error modes, side effects, ordering guarantees, idempotency, retry semantics.

For contracts: list the methods with their signatures, pre/post conditions, and which exceptions are part of the contract vs. implementation-specific.

## Validation criteria
Testable assertions. For each:

- **Given** [precondition], **when** [action], **then** [observable outcome].
- **Coverage**: unit | integration | conformance | golden-set | property | smoke | manual-review.
- **Test**: link to the test file (or `TBD: <path>` if not yet written).

Group criteria into:

### Functional
What the spec does correctly.

### Non-functional
Performance, cost, latency, error budgets.

### Failure modes
What the spec does when things go wrong (network failure, malformed input, partial failure, concurrent access).

## Counter-examples
What this spec rejects or disallows. Use these to write `expect(...).toThrow(...)` tests.

## Open questions
- [ ] Anything still under negotiation. Each item should specify what would resolve it.

## ADRs
Links to the decisions that shaped this spec. Reverse: each ADR links to the specs it constrains.
```

## Falsifiability template (ADRs only)

ADRs do not describe code; they describe decisions. The criteria for an ADR are not "what tests pass" but "what observation would tell us this decision was wrong." This is a kill switch — if the criterion is ever met, the ADR is up for revision.

```markdown
# ADR NNNN: [Decision title]

## Status
Accepted | Superseded by NNNN | Revisited <date>

## Context
What forced this decision. The constraints, the tradeoffs considered.

## Decision
What we decided. Single declarative paragraph.

## Consequences
What this enables. What this forecloses. Migration cost if reversed.

## Alternatives considered
Each alternative gets one paragraph: what it is, why we did not pick it.

## Falsifiability criteria
Concrete, observable conditions that, if met, would tell us this decision was wrong. Each criterion should specify how it would be measured and what the response would be (revisit, deprecate, supersede).

- **Trigger**: [observable event or threshold].
- **Measurement**: [how we would know].
- **Response**: revisit | supersede | deprecate.

If you cannot list at least one falsifiability criterion, the ADR is not yet a decision — it is a preference. Either tighten the decision until it is falsifiable, or downgrade it to a design note.

## References
Links to the discussions, prior art, related ADRs.
```

## Examples

### Example: contract-style validation criteria

> Spec: `EvidenceStore.put(payload, meta) -> { key, sha256 }`
>
> ### Functional
> - **Given** a `Buffer` payload, **when** `put` is called, **then** the returned `sha256` equals `crypto.createHash('sha256').update(payload).digest('hex')`. Coverage: conformance. Test: `packages/storage/src/conformance/evidence-store.suite.ts::put_returns_correct_sha256`.
> - **Given** the same payload twice, **when** `put` is called twice, **then** both calls return the same `sha256` and the underlying storage holds the bytes exactly once. Coverage: conformance. Test: `packages/storage/src/conformance/evidence-store.suite.ts::put_is_content_addressed`.
>
> ### Non-functional
> - **Given** a 10 MB payload, **when** `put` is called against the disk backend, **then** it returns within 1 second on a 2020-era SSD. Coverage: smoke. Test: `packages/storage/tests/disk-evidence-store.bench.ts::put_10mb_under_1s`.
>
> ### Failure modes
> - **Given** a payload and a backend whose underlying storage is full, **when** `put` is called, **then** it throws `EvidenceStoreFullError` and leaves no partial file behind (atomic-write contract). Coverage: conformance. Test: `…::put_atomic_under_disk_full`.

### Example: ADR-style falsifiability criteria

> ADR: 0006 — Pluggable everything.
>
> ## Falsifiability criteria
> - **Trigger**: adding a new backend for any contract requires modifying more than 2 consumer packages.
>   **Measurement**: PR diff stat in the contract package + each backend package; if a `packages/storage-supabase` PR also touches `packages/dedup` or `apps/cli`, the principle is failing.
>   **Response**: revisit the contract; the abstraction is leaking.
> - **Trigger**: any consumer package imports a backend package directly (instead of resolving via `bind*()`).
>   **Measurement**: `pnpm lint:specs --no-direct-backend-imports`.
>   **Response**: revisit the consumer; refactor through the contract.

## Negotiating criteria with specs

The discipline is not "write the spec, then think about how to test it." It is **co-designing** the spec and its criteria. The hardest specs to test are usually the ones with the most ambiguity in behavior — writing the criteria forces the ambiguity into the open and resolves it.

When reviewing a spec PR, the reviewer must check:

1. Does every assertion in `## Behavior` correspond to at least one assertion in `## Validation criteria`?
2. Is each criterion observable from outside the implementation (i.e., a black-box test, not "the function calls X internally")?
3. Are failure modes covered, not just happy paths?
4. For contracts: is there a conformance suite that any backend can be run against?
5. For ADRs: is there at least one falsifiability criterion that could realistically trigger?

If the answer to any of these is no, the spec is not done.
