import type { CanonicalDeal, SourceRecord } from "@clearbolt/core";
import type { PrismaClient } from "@clearbolt/db";
import type { PreparedSearchQuery } from "@clearbolt/search";
import type { Pool } from "pg";

type PrismaDelegate = InstanceType<typeof PrismaClient>;

export interface DealSearchHit {
  canonicalId: string;
  rank: number;
}

function titleFromSources(sources: SourceRecord[]): string | null {
  for (const s of sources) {
    const t = s.parsedFields?.title;
    if (t) return t;
  }
  return null;
}

function locationFromSource(s: SourceRecord): string | null {
  const { city, state } = s.parsedFields ?? {};
  if (city && state) return `${city}, ${state}`;
  if (state) return state;
  if (city) return city;
  return null;
}

export function buildDealSearchDocument(
  deal: CanonicalDeal,
  sources: SourceRecord[],
): {
  adapters: string[];
  title: string | null;
  location: string | null;
  document: string;
} {
  const rep =
    sources.find((s) => s.id === deal.representativeSourceId) ?? sources[0];
  const adapters = [...new Set(sources.map((s) => s.adapter))].sort();
  const title = titleFromSources(sources);
  const location = rep ? locationFromSource(rep) : null;
  const document = [
    title,
    location,
    ...sources.map((s) => s.parsedFields?.industry),
    ...sources.map((s) => s.parsedFields?.brokerName),
    ...sources.map((s) => s.url),
    ...sources.flatMap((s) =>
      s.parsedFields?.askingPrice != null
        ? [String(s.parsedFields.askingPrice)]
        : [],
    ),
  ]
    .filter((x): x is string => Boolean(x))
    .join(" ");

  return { adapters, title, location, document };
}

export async function upsertDealSearchIndex(
  prisma: PrismaDelegate,
  deal: CanonicalDeal,
  sources: SourceRecord[],
): Promise<void> {
  if (sources.length === 0) return;
  const { adapters, title, location, document } = buildDealSearchDocument(
    deal,
    sources,
  );
  await prisma.dealSearchIndexRow.upsert({
    where: { canonicalId: deal.id },
    create: {
      canonicalId: deal.id,
      adapters,
      title,
      location,
      document,
    },
    update: { adapters, title, location, document },
  });
}

export async function reindexAllDealSearch(
  prisma: PrismaDelegate,
  listCanonicalIds: () => Promise<string[]>,
  getCanonical: (id: string) => Promise<CanonicalDeal | null>,
  getSource: (id: string) => Promise<SourceRecord | null>,
): Promise<number> {
  let count = 0;
  const ids = await listCanonicalIds();
  for (const id of ids) {
    const deal = await getCanonical(id);
    if (!deal) continue;
    const sources: SourceRecord[] = [];
    for (const sid of deal.sourceIds) {
      const s = await getSource(sid);
      if (s) sources.push(s);
    }
    if (sources.length === 0) continue;
    try {
      await upsertDealSearchIndex(prisma, deal, sources);
      count++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("deal_search_index")) return count;
      throw err;
    }
  }
  return count;
}

export interface FtsSearchOptions {
  limit?: number;
  adapter?: string | null;
  /** Minimum pg_trgm similarity when FTS returns no rows. */
  trgmThreshold?: number;
  /** Canonical ids to exclude (e.g. already shown as strict matches). */
  excludeCanonicalIds?: string[];
}

/**
 * Ranked canonical ids: Postgres FTS first, then pg_trgm fuzzy fallback on title/location.
 */
export async function searchDealSearchIndex(
  pool: Pool,
  prepared: PreparedSearchQuery,
  options: FtsSearchOptions = {},
): Promise<DealSearchHit[]> {
  const limit = options.limit ?? 100;
  const fts = prepared.ftsQuery.trim();
  const trgm = prepared.trgmQuery.trim();
  if (!fts && !trgm) return [];

  try {
    return await searchDealSearchIndexInner(pool, options, limit, fts, trgm);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("deal_search_index")) return [];
    throw err;
  }
}

async function searchDealSearchIndexInner(
  pool: Pool,
  options: FtsSearchOptions,
  limit: number,
  fts: string,
  trgm: string,
): Promise<DealSearchHit[]> {
  const adapter =
    options.adapter?.trim() && options.adapter.trim() !== "all"
      ? options.adapter.trim()
      : null;
  const adapterFilter = adapter ? "AND $3::text = ANY(adapters)" : "";
  const trgmThreshold = options.trgmThreshold ?? 0.25;

  if (fts) {
    const params: string[] = [fts, String(limit)];
    if (adapter) params.push(adapter);
    const { rows } = await pool.query<{
      canonical_id: string;
      rank: number;
    }>(
      `SELECT canonical_id,
              ts_rank_cd(search_vector, websearch_to_tsquery('english', $1)) AS rank
       FROM deal_search_index
       WHERE search_vector @@ websearch_to_tsquery('english', $1)
         ${adapterFilter}
       ORDER BY rank DESC
       LIMIT $2`,
      params,
    );
    if (rows.length > 0) {
      return rows.map((r) => ({
        canonicalId: r.canonical_id,
        rank: Number(r.rank),
      }));
    }
  }

  if (!trgm) return [];

  const params: (string | number)[] = [trgm, trgmThreshold, limit];
  let adapterClause = "";
  if (adapter) {
    adapterClause = "AND $4::text = ANY(adapters)";
    params.push(adapter);
  }
  const { rows } = await pool.query<{
    canonical_id: string;
    rank: number;
  }>(
    `SELECT canonical_id,
            GREATEST(
              similarity(coalesce(title, ''), $1),
              similarity(coalesce(location, ''), $1),
              similarity(document, $1)
            ) AS rank
     FROM deal_search_index
     WHERE GREATEST(
             similarity(coalesce(title, ''), $1),
             similarity(coalesce(location, ''), $1),
             similarity(document, $1)
           ) >= $2
       ${adapterClause}
     ORDER BY rank DESC
     LIMIT $3`,
    params,
  );
  return rows.map((r) => ({
    canonicalId: r.canonical_id,
    rank: Number(r.rank),
  }));
}

/** Escape tokens for `to_tsquery` OR clauses. */
function toTsQueryOrClause(raw: string): string | null {
  const tokens = raw
    .split(/\s*\|\s*|\s+/)
    .map((t) => t.replace(/[^a-zA-Z0-9]/g, "").trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.join(" | ");
}

/** OR-style / broadened FTS (e.g. `pool | services`) for related results. */
export async function searchDealSearchIndexOr(
  pool: Pool,
  orFtsQuery: string,
  options: FtsSearchOptions = {},
): Promise<DealSearchHit[]> {
  const fts = toTsQueryOrClause(orFtsQuery);
  if (!fts) return [];
  const limit = options.limit ?? 100;
  const exclude = new Set(options.excludeCanonicalIds ?? []);

  try {
    const adapter =
      options.adapter?.trim() && options.adapter.trim() !== "all"
        ? options.adapter.trim()
        : null;
    const adapterFilter = adapter ? "AND $3::text = ANY(adapters)" : "";
    const params: string[] = [fts, String(limit)];
    if (adapter) params.push(adapter);
    const { rows } = await pool.query<{
      canonical_id: string;
      rank: number;
    }>(
      `SELECT canonical_id,
              ts_rank_cd(search_vector, to_tsquery('english', $1)) AS rank
       FROM deal_search_index
       WHERE search_vector @@ to_tsquery('english', $1)
         ${adapterFilter}
       ORDER BY rank DESC
       LIMIT $2`,
      params,
    );
    return rows
      .filter((r) => !exclude.has(r.canonical_id))
      .map((r) => ({
        canonicalId: r.canonical_id,
        rank: Number(r.rank) * 0.9,
      }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("deal_search_index")) return [];
    throw err;
  }
}
