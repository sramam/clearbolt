import type { CanonicalDeal, SourceRecord } from "@clearbolt/core";
import {
  mergeRelaxedFtsQuery,
  prepareSearchQuery,
  type PreparedSearchQuery,
} from "@clearbolt/search";
import {
  NeonMetadataStore,
  neonMetadataConfigFromEnv,
  searchDealSearchIndex,
  searchDealSearchIndexOr,
} from "@clearbolt/storage-neon";

export interface DealListingDTO {
  canonicalId: string;
  title: string | null;
  location: string | null;
  askingPrice: number | null;
  sources: { adapter: string; url: string; sourceRecordId: string }[];
  /** Present when result came from Postgres FTS / trgm ranking. */
  searchRank?: number;
  /** Why this row appears (for transparency UI). */
  matchKind?: "strict" | "related" | "corpus";
  /** Which query terms appear in the haystack (for highlighting). */
  matchedTokens?: string[];
  missedTokens?: string[];
}

export interface SearchDiagnostics {
  prepared: PreparedSearchQuery;
  /** Effective relaxed FTS string used for related results. */
  relaxedFtsUsed: string;
  strictMatchCount: number;
  relatedMatchCount: number;
  usedOrFallback: boolean;
  llmSynonyms: string[];
}

/** Searchable text for a deal (title, location, ids, urls). */
export function buildDealSearchHaystack(dto: DealListingDTO): string {
  return [
    dto.title,
    dto.location,
    dto.canonicalId,
    dto.askingPrice != null ? String(dto.askingPrice) : null,
    ...dto.sources.map((s) => `${s.adapter} ${s.url}`),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Every whitespace-separated token must appear somewhere in the haystack. */
export function matchesDealQuery(haystack: string, query: string): boolean {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return true;
  return tokens.every((t) => haystack.includes(t));
}

/** At least one token appears in the haystack. */
export function matchesDealQueryOr(haystack: string, query: string): boolean {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return true;
  return tokens.some((t) => haystack.includes(t));
}

function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function tokenMatchSummary(
  haystack: string,
  tokens: string[],
): { matched: string[]; missed: string[] } {
  const matched: string[] = [];
  const missed: string[] = [];
  for (const t of tokens) {
    if (haystack.includes(t.toLowerCase())) matched.push(t);
    else missed.push(t);
  }
  return { matched, missed };
}

export function filterDealsBySource(
  listings: DealListingDTO[],
  sourceFilter: string | null | undefined,
): DealListingDTO[] {
  const sf = sourceFilter?.trim();
  if (!sf || sf === "all") return listings;
  return listings.filter((d) => d.sources.some((s) => s.adapter === sf));
}

export function filterDealsByQuery(
  listings: DealListingDTO[],
  query: string | null | undefined,
): DealListingDTO[] {
  const q = query?.trim() ?? "";
  if (!q) return listings;
  return listings.filter((d) =>
    matchesDealQuery(buildDealSearchHaystack(d), q),
  );
}

function locationFromParsed(s: SourceRecord): string | null {
  const { city, state } = s.parsedFields;
  if (city && state) return `${city}, ${state}`;
  if (state) return state;
  if (city) return city;
  return null;
}

function titleFromDeal(
  deal: CanonicalDeal,
  sources: SourceRecord[],
): string | null {
  const rep = sources.find((x) => x.id === deal.representativeSourceId);
  const t = rep?.parsedFields?.title;
  if (t) return t;
  for (const s of sources) {
    if (s.parsedFields?.title) return s.parsedFields.title;
  }
  return null;
}

function askingFromSources(sources: SourceRecord[]): number | null {
  for (const s of sources) {
    const p = s.parsedFields?.askingPrice;
    if (typeof p === "number") return p;
  }
  return null;
}

function dtoFromDeal(
  deal: CanonicalDeal,
  resolved: SourceRecord[],
  opts?: {
    searchRank?: number;
    matchKind?: DealListingDTO["matchKind"];
    tokens?: string[];
  },
): DealListingDTO | null {
  if (resolved.length === 0) return null;
  const title = titleFromDeal(deal, resolved);
  const location = locationFromParsed(
    resolved.find((s) => s.id === deal.representativeSourceId) ?? resolved[0],
  );
  const dto: DealListingDTO = {
    canonicalId: deal.id,
    title,
    location,
    askingPrice: askingFromSources(resolved),
    sources: resolved.map((s) => ({
      adapter: s.adapter,
      url: s.url,
      sourceRecordId: s.id,
    })),
    searchRank: opts?.searchRank,
    matchKind: opts?.matchKind,
  };
  if (opts?.tokens?.length) {
    const { matched, missed } = tokenMatchSummary(
      buildDealSearchHaystack(dto),
      opts.tokens,
    );
    dto.matchedTokens = matched;
    dto.missedTokens = missed;
  }
  return dto;
}

async function collectAllDtos(
  store: NeonMetadataStore,
  maxScan: number,
): Promise<DealListingDTO[]> {
  const ids = await store.listCanonicalIds();
  const out: DealListingDTO[] = [];

  for (const id of ids) {
    if (out.length >= maxScan) break;
    const deal = await store.getCanonical(id);
    if (!deal) continue;

    const resolved: SourceRecord[] = [];
    for (const sid of deal.sourceIds) {
      const s = await store.getSource(sid);
      if (s) resolved.push(s);
    }
    const dto = dtoFromDeal(deal, resolved);
    if (dto) out.push(dto);
  }

  return out;
}

async function loadDtosByCanonicalIds(
  store: NeonMetadataStore,
  hits: { canonicalId: string; rank: number }[],
  matchKind: DealListingDTO["matchKind"],
  tokens: string[],
): Promise<DealListingDTO[]> {
  const out: DealListingDTO[] = [];
  for (const hit of hits) {
    const deal = await store.getCanonical(hit.canonicalId);
    if (!deal) continue;
    const resolved: SourceRecord[] = [];
    for (const sid of deal.sourceIds) {
      const s = await store.getSource(sid);
      if (s) resolved.push(s);
    }
    const dto = dtoFromDeal(deal, resolved, {
      searchRank: hit.rank,
      matchKind,
      tokens,
    });
    if (dto) out.push(dto);
  }
  return out;
}

export function listDistinctAdapters(listings: DealListingDTO[]): string[] {
  const s = new Set<string>();
  for (const d of listings) {
    for (const src of d.sources) s.add(src.adapter);
  }
  return [...s].sort();
}

function annotateCorpusFallback(
  listings: DealListingDTO[],
  tokens: string[],
  matchKind: "corpus",
): DealListingDTO[] {
  return listings.map((d) => {
    const { matched, missed } = tokenMatchSummary(
      buildDealSearchHaystack(d),
      tokens,
    );
    return {
      ...d,
      matchKind,
      matchedTokens: matched,
      missedTokens: missed,
    };
  });
}

/** Loads canonical deals; uses Neon FTS when `query` is set, else scans up to maxScan. */
export async function loadDealsForSearchPage(options: {
  maxScan?: number;
  sourceFilter?: string | null;
  query?: string | null;
  /** Broadened FTS string from search run (strict + OR + optional AI). */
  relaxedFts?: string | null;
  /** AI synonym tokens for display (`llmSyn` query param). */
  llmSynonyms?: string[];
  /** Canonical ids from the latest scrape (`ingested` query param). */
  ingestedCanonicalIds?: string[];
}): Promise<{
  listings: DealListingDTO[];
  relatedListings: DealListingDTO[];
  justFetched: DealListingDTO[];
  diagnostics: SearchDiagnostics | null;
  adapters: string[];
  totalDeals: number;
  sourceDealsBeforeQuery: number;
  queryExpanded: boolean;
  queryExpansions: string[];
}> {
  const cfg = neonMetadataConfigFromEnv();
  if (!cfg) {
    return {
      listings: [],
      relatedListings: [],
      justFetched: [],
      diagnostics: null,
      adapters: [],
      totalDeals: 0,
      sourceDealsBeforeQuery: 0,
      queryExpanded: false,
      queryExpansions: [],
    };
  }

  const store = new NeonMetadataStore(cfg);
  const rawQuery = options.query?.trim() ?? "";
  const prepared = prepareSearchQuery(rawQuery);
  const llmSynonyms = options.llmSynonyms ?? [];
  const relaxedFtsUsed =
    options.relaxedFts?.trim() ||
    (llmSynonyms.length > 0
      ? mergeRelaxedFtsQuery(prepared, {
          ftsOrTerms: llmSynonyms.join(" | "),
          synonyms: llmSynonyms,
          note: "",
        })
      : prepared.ftsQueryRelaxed);

  try {
    const idCount = (await store.listCanonicalIds()).length;
    const maxScan = options.maxScan ?? Math.min(idCount, 2000);
    const sf = options.sourceFilter?.trim();
    const adapterFilter =
      sf && sf !== "all" ? sf : null;

    const corpus = await collectAllDtos(store, maxScan);
    const corpusSourceScoped = filterDealsBySource(corpus, sf);
    const adapters = listDistinctAdapters(
      filterDealsBySource(corpus, sf === "all" ? null : sf),
    );

    const ingestedIds = (options.ingestedCanonicalIds ?? []).filter(Boolean);
    let justFetched: DealListingDTO[] = [];
    if (ingestedIds.length > 0) {
      justFetched = await loadDtosByCanonicalIds(
        store,
        ingestedIds.map((canonicalId) => ({ canonicalId, rank: 1 })),
        "corpus",
        prepared.tokens,
      );
    }
    const ingestedSet = new Set(ingestedIds);

    let listings: DealListingDTO[] = [];
    let relatedListings: DealListingDTO[] = [];
    let usedOrFallback = false;
    let strictMatchCount = 0;
    let relatedMatchCount = 0;

    if (prepared.ftsQuery) {
      let strictHits = await searchDealSearchIndex(store.pgPool(), prepared, {
        limit: maxScan,
        adapter: adapterFilter,
      });
      if (strictHits.length === 0 && idCount > 0) {
        await store.reindexAllDealSearch();
        strictHits = await searchDealSearchIndex(store.pgPool(), prepared, {
          limit: maxScan,
          adapter: adapterFilter,
        });
      }
      strictMatchCount = strictHits.length;

      const strictIds = strictHits.map((h) => h.canonicalId);
      const relatedHits = await searchDealSearchIndexOr(
        store.pgPool(),
        relaxedFtsUsed,
        {
          limit: maxScan,
          adapter: adapterFilter,
          excludeCanonicalIds: strictIds,
        },
      );
      relatedMatchCount = relatedHits.length;

      if (strictHits.length > 0) {
        listings = await loadDtosByCanonicalIds(
          store,
          strictHits.filter((h) => !ingestedSet.has(h.canonicalId)),
          "strict",
          prepared.tokens,
        );
      }
      if (relatedHits.length > 0) {
        relatedListings = await loadDtosByCanonicalIds(
          store,
          relatedHits.filter((h) => !ingestedSet.has(h.canonicalId)),
          "related",
          prepared.tokens,
        );
      }

      if (listings.length === 0 && relatedListings.length === 0) {
        usedOrFallback = true;
        const andFiltered = filterDealsByQuery(
          corpus,
          prepared.searchKeywords || rawQuery,
        );
        if (andFiltered.length > 0) {
          listings = annotateCorpusFallback(
            andFiltered,
            prepared.tokens,
            "corpus",
          );
        } else {
          const orFiltered = corpus.filter((d) =>
            matchesDealQueryOr(
              buildDealSearchHaystack(d),
              prepared.searchKeywords || rawQuery,
            ),
          );
          relatedListings = annotateCorpusFallback(
            orFiltered,
            prepared.tokens,
            "corpus",
          );
        }
      }
    } else {
      listings = corpus;
    }

    const sourceScoped = filterDealsBySource(listings, sf);
    const relatedScoped = filterDealsBySource(relatedListings, sf);

    const diagnostics: SearchDiagnostics | null = prepared.ftsQuery
      ? {
          prepared,
          relaxedFtsUsed,
          strictMatchCount,
          relatedMatchCount,
          usedOrFallback,
          llmSynonyms,
        }
      : null;

    return {
      listings: sourceScoped,
      relatedListings: relatedScoped,
      justFetched: filterDealsBySource(justFetched, sf),
      diagnostics,
      adapters,
      totalDeals: idCount,
      sourceDealsBeforeQuery: corpusSourceScoped.length,
      queryExpanded: prepared.didExpand,
      queryExpansions: prepared.expansions,
    };
  } finally {
    await store.disconnect();
  }
}
