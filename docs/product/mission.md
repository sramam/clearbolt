# Mission

**Clearbolt helps ETA searchers find, organize, and evaluate acquisition opportunities.**

The user is not "a scraper user." The user is a searcher trying to build a proprietary or semi-proprietary deal pipeline across:

- **On-market deals**: BizBuySell, BizQuest, BusinessesForSale, broker websites, newsletters, public marketplaces.
- **Off-market targets**: manually researched companies, uploaded lists, outbound prospecting, partner data, referrals, and future enrichment providers.

The product should compress the searcher's workflow: define a market, capture buyer capacity, find targets, remove duplicates, enrich missing details, rank fit and affordability, assess quality of deal, manage outreach, and move promising companies through a pipeline. Deal-team shopping is a later roadmap surface once the buyer workflow and trust model are strong.

## Target personas

See [personas.md](personas.md). Different searcher types want different defaults; design with them in mind.

## Related

- [principles.md](principles.md) — product principles
- [glossary.md](glossary.md) — ETA shorthand used throughout
- [surfaces.md](surfaces.md) — core product surfaces
- [feedback-personalization.md](feedback-personalization.md) — listing feedback and personalization

`TODO:` Confirm initial ICP and which personas drive V1 defaults.

## Validation criteria

Mission-level validation is mostly about heuristic alignment: does what we ship feel like it serves the mission? But a few falsifiable conditions apply.

### Heuristics
- **Given** a feature proposal in any RFC or PR, **when** reviewed, **then** at least one searcher-workflow step it serves is named explicitly (criteria, saved search, watchlist, outreach, notes, pipeline, diligence, deal-team). Coverage: PR review checklist.
- **Given** the V1 launch, **when** measured against the mission statement, **then** all of: `define a market`, `capture buyer capacity`, `find targets`, `remove duplicates`, `rank fit and affordability` have at least a thin product surface; `manage outreach` and `move through pipeline` may be V1.5 or V2 surfaces.

### Falsifiability
- **Given** the V1 product, **when** reviewed by an actual ETA searcher, **then** they describe it as helping with their search workflow (not "a scraper" or "a CRM"). Coverage: 5+ user interviews at V1 launch. If breached, mission framing or product surfaces are wrong.
- **Given** the persona mix at V1 launch, **when** measured at 90 days, **then** at least one of the personas in [personas.md](personas.md) shows weekly active usage; if none do, persona targeting or product fit is wrong. Coverage: smoke (PostHog cohort).

### Cross-link
- Persona-driven defaults are validated in [personas.md](personas.md).
- Roadmap surfaces (deal-team shopping, provider surfaces) appear under "Roadmap" in [surfaces.md](surfaces.md) and are gated by the V3+ validation criteria in [../phases/V3-plus.md](../phases/V3-plus.md).
