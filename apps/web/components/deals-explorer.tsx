import { DealSearchForm } from "@/components/deal-search-form";
import {
  IconToggleGroup,
  IconToggleLink,
} from "@/components/icon-toggle-link";
import { SearchInsightsPanel } from "@/components/search-insights-panel";
import { PromoteDealButton } from "@/components/promote-deal-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { DealListingDTO, SearchDiagnostics } from "@/lib/deals";
import { buildSearchHref } from "@/lib/search-url";
import { cn } from "@/lib/utils";
import { LayoutGrid, List } from "lucide-react";
import Link from "next/link";

function formatMoney(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function tabClass(active: boolean): string {
  return cn(
    "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
    active
      ? "bg-primary text-primary-foreground"
      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

function MatchHint({ deal }: { deal: DealListingDTO }) {
  if (!deal.matchedTokens?.length && !deal.missedTokens?.length) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {deal.matchedTokens?.length ? (
        <>
          Matches:{" "}
          <span className="text-foreground">
            {deal.matchedTokens.join(", ")}
          </span>
        </>
      ) : null}
      {deal.missedTokens?.length ? (
        <>
          {deal.matchedTokens?.length ? " · " : null}
          Missing:{" "}
          <span className="text-amber-700 dark:text-amber-400">
            {deal.missedTokens.join(", ")}
          </span>
        </>
      ) : null}
    </p>
  );
}

export function DealsExplorer(props: {
  listings: DealListingDTO[];
  relatedListings?: DealListingDTO[];
  justFetched?: DealListingDTO[];
  diagnostics?: SearchDiagnostics | null;
  adapters: string[];
  source: string;
  view: "grid" | "list";
  query: string;
  hasDatabase: boolean;
  signedIn: boolean;
  totalDeals: number;
  sourceDealsBeforeQuery: number;
  scrapedCount?: number | null;
  scrapeError?: string | null;
  queryExpanded?: boolean;
  queryExpansions?: string[];
  discoveryMode?: string | null;
}) {
  const {
    listings,
    relatedListings = [],
    justFetched = [],
    diagnostics = null,
    adapters,
    source,
    view,
    query,
    hasDatabase,
    signedIn,
    totalDeals,
    sourceDealsBeforeQuery,
    scrapedCount,
    scrapeError,
    queryExpanded,
    queryExpansions = [],
    discoveryMode,
  } = props;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search saved deals and fetch fresh BizBuySell listings in one step.
          Results use full-text search with fuzzy matching when needed.
        </p>
      </div>

      {!hasDatabase ? (
        <Card>
          <CardHeader>
            <CardTitle>No database configured</CardTitle>
            <CardDescription>
              Set <code className="rounded bg-muted px-1">DATABASE_URL</code> in{" "}
              <code className="rounded bg-muted px-1">.env.dev</code> and restart
              the web app.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <SearchInsightsPanel
        query={query}
        diagnostics={diagnostics}
        scrapedCount={scrapedCount}
        discoveryMode={discoveryMode}
      />

      {scrapeError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          BizBuySell fetch failed: {scrapeError}
        </p>
      ) : null}

      {queryExpanded && queryExpansions.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Query expanded: {queryExpansions.join("; ")}
        </p>
      ) : null}

      <DealSearchForm defaultQuery={query} source={source} view={view} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">
            Source
          </span>
          <Link
            href={buildSearchHref({ source: "all", view, q: query })}
            className={tabClass(source === "all" || source === "")}
          >
            All
          </Link>
          {adapters.map((a) => (
            <Link
              key={a}
              href={buildSearchHref({ source: a, view, q: query })}
              className={tabClass(source === a)}
            >
              {a}
            </Link>
          ))}
        </div>
        <IconToggleGroup>
          <IconToggleLink
            href={buildSearchHref({ source, view: "grid", q: query })}
            label="Grid view"
            active={view === "grid"}
          >
            <LayoutGrid className="size-4" aria-hidden />
          </IconToggleLink>
          <IconToggleLink
            href={buildSearchHref({ source, view: "list", q: query })}
            label="List view"
            active={view === "list"}
          >
            <List className="size-4" aria-hidden />
          </IconToggleLink>
        </IconToggleGroup>
      </div>

      <Separator />

      <p className="text-sm text-muted-foreground">
        Showing{" "}
        <span className="font-medium text-foreground">
          {justFetched.length + listings.length + relatedListings.length}
        </span>{" "}
        {justFetched.length + listings.length + relatedListings.length === 1
          ? "deal"
          : "deals"}
        {source && source !== "all" ? (
          <>
            {" "}
            from <span className="font-medium text-foreground">{source}</span>
          </>
        ) : null}
        {query ? (
          <>
            {" "}
            matching <span className="font-medium text-foreground">"{query}"</span>
          </>
        ) : null}
        {hasDatabase && totalDeals > 0 ? (
          <span className="text-muted-foreground">
            {" "}
            ({sourceDealsBeforeQuery} in corpus
            {query ? " before text filter" : ""}, {totalDeals} total)
          </span>
        ) : null}
      </p>

      {justFetched.length > 0 ? (
        <>
          <h2 className="text-lg font-semibold tracking-tight">
            Just fetched
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              from your latest BizBuySell run
            </span>
          </h2>
          {renderDealList(justFetched, view, signedIn)}
          <Separator className="my-2" />
        </>
      ) : null}

      {listings.length > 0 ? (
        <>
          {relatedListings.length > 0 ? (
            <h2 className="text-lg font-semibold tracking-tight">
              Best matches
            </h2>
          ) : null}
          {renderDealList(listings, view, signedIn)}
        </>
      ) : null}

      {relatedListings.length > 0 ? (
        <>
          <Separator className="my-2" />
          <h2 className="text-lg font-semibold tracking-tight">
            Related results
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              (may not include every word you typed)
            </span>
          </h2>
          {renderDealList(relatedListings, view, signedIn)}
        </>
      ) : null}

      {!hasDatabase ? null : listings.length === 0 &&
        relatedListings.length === 0 &&
        justFetched.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {query
                ? "No matching deals"
                : totalDeals === 0
                  ? "No deals yet"
                  : "No deals for this source"}
            </CardTitle>
            <CardDescription>
              {query && totalDeals > 0
                ? "Try different keywords or run Search to fetch fresh BizBuySell listings."
                : totalDeals === 0
                  ? "Run a search above to fetch listings from BizBuySell into your database."
                  : "Switch source tabs or clear filters."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}

function renderDealList(
  deals: DealListingDTO[],
  view: "grid" | "list",
  signedIn: boolean,
) {
  if (view === "grid") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {deals.map((deal) => (
          <Card key={deal.canonicalId} className="flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="line-clamp-2 text-base leading-snug">
                {deal.title ?? "Untitled listing"}
              </CardTitle>
              <CardDescription>{deal.location ?? "—"}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto flex flex-col gap-3">
              <MatchHint deal={deal} />
              <p className="text-lg font-semibold tabular-nums">
                {formatMoney(deal.askingPrice)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {deal.sources.map((s) => (
                  <Badge key={s.sourceRecordId} variant="secondary">
                    {s.adapter}
                  </Badge>
                ))}
                {deal.sources.length > 1 ? (
                  <Badge variant="outline">Merged {deal.sources.length}</Badge>
                ) : null}
              </div>
              <PromoteDealButton
                canonicalDealId={deal.canonicalId}
                title={deal.title}
                signedIn={signedIn}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border">
      {deals.map((deal) => (
        <li
          key={deal.canonicalId}
          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">
              {deal.title ?? "Untitled listing"}
            </p>
            <p className="text-sm text-muted-foreground">
              {deal.location ?? "—"} · {formatMoney(deal.askingPrice)}
            </p>
            <MatchHint deal={deal} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {deal.sources.map((s) => (
                <Badge key={s.sourceRecordId} variant="secondary">
                  {s.adapter}
                </Badge>
              ))}
            </div>
          </div>
          <PromoteDealButton
            canonicalDealId={deal.canonicalId}
            title={deal.title}
            signedIn={signedIn}
          />
        </li>
      ))}
    </ul>
  );
}

