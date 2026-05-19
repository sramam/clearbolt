import type { CatalogScrapeRunResult } from "@clearbolt/scraper";
import { writeCatalogRefsFile } from "@clearbolt/scraper";

export async function writeCatalogDiscoverOutput(options: {
  result: CatalogScrapeRunResult;
  catalogUrl: string;
  adapter: string;
  discoverOut?: string;
  defaultRefsPath: string;
  logUrls: boolean;
}): Promise<void> {
  const { result, catalogUrl, adapter, discoverOut, defaultRefsPath, logUrls } =
    options;
  console.log(
    `discovered ${result.listingsDiscovered} listing URL(s) across ${result.pagesFetched} page(s)`,
  );
  const refs =
    result.discoveredListingRefs ??
    result.discoveredListingUrls?.map((url) => ({ url })) ??
    [];
  const outPath = discoverOut ?? defaultRefsPath;
  await writeCatalogRefsFile(outPath, {
    catalogUrl,
    adapter,
    refs,
    complete: true,
    pagesFetched: result.pagesFetched,
  });
  console.log(`wrote ${refs.length} ref(s) to ${outPath}`);
  if (logUrls && !discoverOut) {
    for (const u of result.discoveredListingUrls ?? []) {
      console.log(u);
    }
  }
}

export async function writeCatalogIngestOutput(options: {
  result: CatalogScrapeRunResult;
  catalogUrl: string;
  adapter: string;
  defaultRefsPath: string;
}): Promise<void> {
  const { result, catalogUrl, adapter, defaultRefsPath } = options;
  if (
    result.pagesFetched > 0 &&
    (result.discoveredListingRefs?.length ?? 0) > 0
  ) {
    await writeCatalogRefsFile(defaultRefsPath, {
      catalogUrl,
      adapter,
      refs: result.discoveredListingRefs ?? [],
      complete: true,
      pagesFetched: result.pagesFetched,
    });
    console.log(
      `cached ${result.discoveredListingRefs?.length} ref(s) at ${defaultRefsPath}`,
    );
  }
  const payload: Record<string, unknown> = {
    pagesFetched: result.pagesFetched,
    listingsDiscovered: result.listingsDiscovered,
    thisRun: {
      listingsIngested: result.listingsIngested,
      listingsFailed: result.listingsFailed,
      listingsSkippedKnown: result.listingsSkippedKnown,
      listingsSkippedFresh: result.listingsSkippedFresh,
      canonicalIds: result.canonicalIds.length,
    },
  };
  if (result.overall) {
    payload.overall = result.overall;
  }
  console.log(JSON.stringify(payload, null, 2));
  const untouchedFailures =
    result.overall &&
    result.overall.failed > 0 &&
    result.listingsIngested === 0 &&
    result.listingsFailed === 0;
  const looksLikeCatalogResume =
    result.listingsDiscovered > 1000 && result.listingsSkippedKnown > 0;
  if (untouchedFailures && looksLikeCatalogResume && result.overall) {
    console.log(
      `\nNote: This was catalog-resume mode, not --retry-failures-only. ${result.overall.failed} listing(s) still failed on disk and were not fetched (resume skips satisfied listings and omits hard-block failures from the batch). To retry failures only, run each line separately:\n  pnpm exec tsc -b packages/scraper apps/cli\n  export CLEARBOLT_PROXY_SESSION_ID="retry-$(date +%s)"\n  pnpm clearbolt catalog --retry-failures-only`,
    );
  }
}
