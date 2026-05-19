import { AppShell } from "@/components/app-shell";
import { DealsExplorer } from "@/components/deals-explorer";
import { requireSessionOrRedirect } from "@/lib/auth-session";
import { loadDealsForSearchPage } from "@/lib/deals";
import { databaseUrlFromEnv } from "@clearbolt/db";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search · Clearbolt",
  description: "Browse deduplicated listings by source",
};

type SearchParams = {
  source?: string;
  view?: string;
  q?: string;
  scraped?: string;
  scrapeError?: string;
  expanded?: string;
  discovery?: string;
  relaxedFts?: string;
  llmSyn?: string;
  ingested?: string;
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const source = sp.source?.trim() || "all";
  const view = sp.view === "list" ? "list" : "grid";
  const query = sp.q?.trim() ?? "";
  const llmSynonyms = sp.llmSyn
    ? sp.llmSyn
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const session = await requireSessionOrRedirect("/search");
  const hasDatabase = databaseUrlFromEnv() !== null;
  const ingestedCanonicalIds = sp.ingested
    ? sp.ingested
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];

  const {
    listings,
    relatedListings,
    justFetched,
    diagnostics,
    adapters,
    totalDeals,
    sourceDealsBeforeQuery,
    queryExpanded,
    queryExpansions,
  } = await loadDealsForSearchPage({
    sourceFilter: source,
    query: query || null,
    relaxedFts: sp.relaxedFts ?? null,
    llmSynonyms,
    ingestedCanonicalIds,
  });

  return (
    <AppShell
      signedIn
      userLabel={session.claims.userId.slice(0, 12)}
      devBypass={session.devBypass}
    >
      <DealsExplorer
        listings={listings}
        relatedListings={relatedListings}
        justFetched={justFetched}
        diagnostics={diagnostics}
        adapters={adapters}
        source={source}
        view={view}
        query={query}
        hasDatabase={hasDatabase}
        signedIn
        totalDeals={totalDeals}
        sourceDealsBeforeQuery={sourceDealsBeforeQuery}
        scrapedCount={sp.scraped ? Number.parseInt(sp.scraped, 10) : null}
        scrapeError={sp.scrapeError ?? null}
        queryExpanded={queryExpanded || sp.expanded === "1"}
        queryExpansions={queryExpansions}
        discoveryMode={sp.discovery ?? null}
      />
    </AppShell>
  );
}
