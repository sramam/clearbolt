# Target Personas

Different searcher types want different defaults; design with them in mind.

- **Independent searcher (self-funded)**: solo buyer, often SBA-financed, lower-middle market, sensitive to deal size and personal capacity. Highest weight on affordability and quality-of-deal.
- **Traditional search fund**: principal(s) plus investor base, structured fund economics, typically targets larger deals with QoE and committed equity.
- **Holdco / serial acquirer**: multiple deals over time, wants comps, repeat broker relationships, and pattern reuse across acquisitions.
- **Family office / strategic acquirer**: thesis-driven, may add operating partners, sometimes off-market focused, stricter sharing controls.
- **Search advisor / consultant** (later): supports multiple searchers, may need multi-workspace views.

`TODO:` Confirm initial ICP and which personas drive V1 defaults.

## Validation criteria

Personas exist to drive defaults, not as decoration. Validation is about ensuring each persona translates into something testable.

### Functional
- **Given** the V1 launch, **when** the onboarding flow runs, **then** the user is implicitly or explicitly classified into one of the personas above (used to set defaults for deal size, financing path, and ranking weights). Coverage: integration. Test: `apps/web/tests/persona-defaults-applied.test.ts` (TBD V1).
- **Given** the chosen V1 ICP (resolved from this doc's TODO), **when** any V1 default is set, **then** the default's choice references the persona it serves. Coverage: PR review checklist (V1).

### Heuristics
- **Given** any new product surface, **when** the RFC is reviewed, **then** at least one persona is named as the target user; surfaces that fit no persona must justify why. Coverage: PR review checklist.

### Falsifiability
- **Given** the V1 launch, **when** measured at 90 days, **then** at least one of the listed personas shows weekly active usage. If none do, the persona model is wrong (split, merge, or replace). Coverage: smoke (PostHog cohort).

### Cross-link
- Mission alignment: [mission.md](mission.md) validation criteria.
- ICP-driven defaults: feed [surfaces.md](surfaces.md) onboarding flow.
