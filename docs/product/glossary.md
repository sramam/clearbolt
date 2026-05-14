# Glossary

ETA shorthand used throughout this guide. Keep accurate as terms are added.

- **ETA** — Entrepreneurship Through Acquisition. Buying an existing business as a path to operating it.
- **Searcher** — The buyer running an ETA process.
- **Search fund** — Sponsored search vehicle with investor capital and step-up economics.
- **Self-funded searcher** — Independent buyer using personal/SBA capital and outside investors per deal.
- **Holdco** — Holding company acquiring multiple businesses over time.
- **On-market** — Listing publicly available via marketplace or broker.
- **Off-market** — Target identified through outbound research, referral, or proprietary channel.
- **CIM** — Confidential Information Memorandum. The deal book a broker shares post-NDA.
- **IM** — Information Memorandum. Used interchangeably with CIM in some markets.
- **NDA** — Non-Disclosure Agreement. Required before a CIM is shared.
- **LOI** — Letter of Intent. Non-binding offer that often grants exclusivity.
- **IOI** — Indication of Interest. Earlier, lighter-weight expression of interest.
- **APA** — Asset Purchase Agreement. Definitive document for an asset deal.
- **SPA** — Stock/Share Purchase Agreement. Definitive document for an equity deal.
- **EBITDA** — Earnings before interest, taxes, depreciation, and amortization.
- **SDE** — Seller's Discretionary Earnings. Common for small businesses; adds back owner comp/perks.
- **DSCR** — Debt Service Coverage Ratio. Cash available to service debt.
- **SBA** — U.S. Small Business Administration. SBA 7(a) is a common ETA financing path.
- **Seller financing / seller note** — Portion of price financed by the seller post-close.
- **QoE** — Quality of Earnings. Financial diligence engagement validating reported earnings.
- **Add-back** — Adjustment to reported earnings (owner comp, one-time costs, etc.).
- **Rep & warranty insurance** — Insurance covering breaches of seller representations.
- **Working capital peg** — Target working capital level negotiated at close.
- **Earnout** — Contingent post-close consideration tied to performance.
- **NAICS / SIC** — Industry classification systems.
- **MSA** — Metropolitan Statistical Area; common geo grouping in the US.

`TODO:` Add region-specific terms if/when expanding outside the US.

## Validation criteria

The glossary's validation is about consistency: terms used elsewhere should match terms defined here.

### Functional
- **Given** any term used in `docs/architecture/`, `docs/product/`, `docs/operations/`, or `docs/phases/`, **when** that term has an entry in this glossary, **then** the usage matches the definition. Coverage: lint (informational). Test: `scripts/lint-specs.mjs::glossary_terms_consistent` (TBD V1).
- **Given** any new acronym introduced in product docs, **when** the PR is reviewed, **then** either the acronym is in this glossary or it is added in the same PR. Coverage: PR review checklist.

### Heuristics
- **Given** a new contributor reading the docs in order (mission → personas → principles → surfaces), **when** they hit an unfamiliar acronym, **then** it appears in the glossary. Coverage: contributor-onboarding feedback (qualitative).

### Cross-link
- Region-specific terms: tracked under the existing TODO; resolves when international expansion is on the roadmap.
