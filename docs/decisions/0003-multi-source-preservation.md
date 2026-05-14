# ADR 0003 — Multi-source preservation: SourceRecords are append-only

Status: accepted

## Context

The same business listing is often observed on multiple sites (BizBuySell, BizQuest, the broker's own website) at different times. Sometimes those observations agree; sometimes price, broker, or status differ. Sometimes a single site has internal duplicates.

We need to support all of:

- "Show me where else this deal appears."
- "When did the price drop?"
- "Which adapter saw it first?"
- "BizBuySell says $1.2M and the broker site says $1.5M — what's authoritative?"
- "Why did the system fold these two into one canonical?"

## Decision

`SourceRecord`s are **immutable and append-only**. Dedup attaches them to a `CanonicalDeal`; dedup never deletes them.

- Each observation is its own `SourceRecord` with `(adapter, sourceUrl, fetchedAt, observedAt, evidenceRef)` — even if the listing is identical to one we already saw.
- `CanonicalDeal.sources[]` is an array of `{ sourceRecordId, adapter, url, firstSeenAt, lastSeenAt }`.
- `CanonicalDeal.fieldProvenance` is a per-field map of which `SourceRecord` contributed each value.
- Conflicts are kept; merge policy decides which value to display, but original observations remain intact.
- Intra-source duplicates (e.g. BizBuySell occasionally listing the same business twice) are tracked in `intraSourceDuplicates` so the operator can see what we folded together within the same adapter.

## Consequences

- Storage volume grows with observations, not with unique listings. Acceptable: text + parsed JSON is small; raw HTML is content-addressed in R2 and dedupes naturally on identical payloads.
- Splitting a falsely-merged canonical record is straightforward: re-attach selected `SourceRecord`s to a new canonical.
- Audit and "why" queries are answerable directly from the data, not reconstructed from logs.
- A workspace's per-deal wiki can cite the specific source observation that contributed each fact.

## Falsifiability criteria

- **Trigger**: any code path mutates a `SourceRecord` field after creation (vs creating a new `SourceRecord`).
  **Measurement**: V0 — lint over `packages/storage/src/disk/disk-source-record-store.ts`; V1 — Postgres `BEFORE UPDATE` trigger that raises if any non-pointer field changes.
  **Response**: incident; fix the mutating code, post-mortem to find what broke the discipline.
- **Trigger**: storage cost for `SourceRecord`s exceeds 10× storage cost for `CanonicalDeal`s on a sustained basis (3 months).
  **Measurement**: monthly cost report.
  **Response**: revisit retention policy; consider hot/cold tiering of older `SourceRecord`s to R2 deep-archive while keeping the references in `MetadataStore`.
- **Trigger**: splitting a falsely-merged canonical record requires manual data surgery (not a single API call).
  **Measurement**: incident report from operations team.
  **Response**: build the split-canonical operator tool; the design assumes splits are easy.
- **Trigger**: `fieldProvenance` map is missing for >5% of fields on V1+ canonical deals.
  **Measurement**: query over `MetadataStore`.
  **Response**: revisit the merge policy; provenance is supposed to be free with the design.
