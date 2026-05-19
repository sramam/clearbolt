# `apps/web`

> Next.js app for V1 (CF Pages target). UI uses **shadcn/ui-style** primitives (Radix + `class-variance-authority` + Tailwind) under `components/ui/`; `components.json` is present so `pnpm dlx shadcn@latest add …` can extend the set.

## Scope (current)

### Shell and navigation

- **App Router** (`app/`), Tailwind + CSS variables (zinc-style theme).
- **`/`** redirects to **`/search`**.
- **`AppShell`** — collapsible left sidebar; collapse state in `localStorage` (`clearbolt.sidebarCollapsed`).

### `/search` — deal explorer

- **Source tabs** via URL `?source=<adapter>|all` (`<Link>` for back/forward).
- **Grid / list** via `?view=grid|list` (default `grid`).
- **Text filter** via `?q=` — when `DATABASE_URL` is set, uses Postgres FTS via [`packages/storage-neon`](../../packages/storage-neon/agents.md) `searchDealSearchIndex` with relaxed OR fallback; otherwise in-memory filter on loaded deals (`lib/deals.ts`).
- **Query prep** — [`packages/search`](../../packages/search/agents.md) `prepareSearchQuery` (typos, tokenization); optional LLM expand via `CLEARBOLT_SEARCH_EXPAND_LLM` (`?expanded=1`, `?llmSyn=`).
- **Run search** — `DealSearchForm` + server action `runDealSearch`: expands query → runs BizBuySell scrape (in-process or [`scraper-service`](../../apps/scraper-service/agents.md)) → redirects with `?ingested=<canonicalIds>` and scrape diagnostics (`scraped`, `scrapeError`, `discovery`).
- **Cards** — merged sources as badges, promote-to-project control, search insights panel.

### `/projects`

- Lists workspace projects from Neon (`app/actions/projects.ts`); promote flow ties canonical deals to `workspace_projects`.

### Auth

- **`/sign-in`** — Google, GitHub, email OTP via better-auth ([`packages/auth`](../../packages/auth/agents.md)).
- **`middleware.ts`** — redirects unauthenticated users to `/sign-in` except public paths (`/sign-in`, `/api/auth/*`, static assets). Uses `GET /api/auth/get-session` when `BETTER_AUTH_SECRET` + `DATABASE_URL` are configured.
- **Dev bypass** — `CLEARBOLT_DEV_USER_ID` (+ optional `CLEARBOLT_DEV_WORKSPACE_ID`) when better-auth is not configured (`lib/auth-config.ts`, `lib/auth-session.ts`).
- **Route handler** — `app/api/auth/[...all]/route.ts` mounts `getClearboltAuth().handler`.

### Storage binding

- `lib/bind-storage.ts` — disk or cloud (same env contract as CLI: `CLEARBOLT_STORAGE`, R2, `DATABASE_URL`).
- `next.config.ts` loads repo-root `.env.cloud.local` → `.env.dev` → `.env`.

### Scraper integration

- Prefer **`CLEARBOLT_SCRAPER_SERVICE_URL`** + optional `CLEARBOLT_SCRAPER_SERVICE_SECRET` (`lib/scraper-service-client.ts`, NDJSON progress).
- Fallback: in-process scrape via `lib/bizbuysell-scrape.ts` when service URL is unset.

## Auth and tenancy (V1)

- **Session:** better-auth session; server actions call `requireSessionOrRedirect`.
- **Claims (target):** `userId` + active org as `workspaceId` on every team-scoped Neon write ([`packages/auth`](../../packages/auth/agents.md), ADR 0012).
- **Tenant rules:** team data filters by `workspace_id`; user-scoped rows by internal `user_id` / `owner_user_id`, never email ([`teams-projects-dealbox.md`](../../docs/architecture/teams-projects-dealbox.md)).

## Dev commands

```bash
pnpm dev                    # web + deps (see root package.json)
pnpm scraper-service:dev    # terminal 1 when using remote scrape
```

Env template: [`.env.example`](../../.env.example).

## Validation criteria

### Build
- **Given** a clean checkout with dependencies installed, **when** `pnpm --filter @clearbolt/web build` runs, **then** Next.js completes with exit 0. Coverage: smoke. Test: CI `pnpm build` (root includes web build).

### Auth config
- **Given** `DATABASE_URL` and a 32+ char `BETTER_AUTH_SECRET`, **when** `isBetterAuthConfigured` runs, **then** it returns true. Coverage: unit. Test: `apps/web/tests/auth-config.test.ts`.
- **Given** `CLEARBOLT_DEV_USER_ID` and no auth secret, **when** `hasDevAuthBypass` runs, **then** it returns true; with full auth env it returns false. Coverage: unit. Test: `apps/web/tests/auth-config.test.ts`.

### Deal filtering (in-memory path)
- **Given** a `DealListingDTO` haystack, **when** `matchesDealQuery` runs, **then** all query tokens must appear for a match. Coverage: unit. Test: `apps/web/tests/deals-filter.test.ts`.

### URL-driven browsing
- **Given** the user changes source tab, layout, or filter, **when** they use the browser Back button, **then** the prior `source`, `view`, and `q` query values are restored (navigation uses `<Link href="/search?…">` and GET form). Coverage: manual / e2e (TBD).

### Multi-source clarity
- **Given** a canonical deal with more than one `SourceRecord`, **when** `/search` renders its card, **then** each adapter appears as its own badge and “Merged n” is shown when `n > 1`. Coverage: manual. Test: e2e with fixture DB (TBD).

### Auth-scoped data access
- **Given** a signed-in user, **when** the app loads user-scoped queries or projects, **then** it uses `userId` from the session and `workspaceId` from the active org, never email as a storage key. Coverage: integration. Test: `apps/web/tests/tenant-isolation/session-scopes-metadata.test.ts` (TBD V1).

### Cross-link
- Auth: [`packages/auth/agents.md`](../../packages/auth/agents.md).
- Scraper service: [`apps/scraper-service/agents.md`](../../apps/scraper-service/agents.md).
- FTS: [`packages/storage-neon/agents.md`](../../packages/storage-neon/agents.md), [`packages/search/agents.md`](../../packages/search/agents.md).
