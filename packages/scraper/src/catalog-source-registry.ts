import { BIZBUYSELL_CALIFORNIA_CATALOG_URL } from "./adapters/bizbuysell/catalog.js";
import { BUSINESSBROKER_CALIFORNIA_CATALOG_URL } from "./adapters/businessbroker/catalog.js";
import { BUSINESSES_FOR_SALE_CALIFORNIA_CATALOG_URL } from "./adapters/businessesforsale/catalog.js";
import { DEALSTREAM_CALIFORNIA_CATALOG_URL } from "./adapters/dealstream/catalog.js";
import { LOOPNET_CALIFORNIA_CATALOG_URL } from "./adapters/loopnet/catalog.js";
import { catalogAdapterFromUrl } from "./catalog-adapter-from-url.js";

export const CATALOG_SOURCE_IDS = [
  "bizbuysell",
  "businessbroker",
  "dealstream",
  "loopnet",
  "businessesforsale",
] as const;

export type CatalogSourceId = (typeof CATALOG_SOURCE_IDS)[number];

export interface CatalogSourceDefinition {
  id: CatalogSourceId;
  label: string;
  defaultCatalogUrl: string;
  /** Short hint shown in interactive menus and `catalog --list-sources`. */
  notes: string;
  ingestSupported: boolean;
  /** Live discovery typically needs Playwright (Akamai / SPA). */
  browserRequired: boolean;
  /** `--fixtures` replay is wired for this source. */
  fixturesSupported: boolean;
}

export const CATALOG_SOURCES: readonly CatalogSourceDefinition[] = [
  {
    id: "bizbuysell",
    label: "BizBuySell",
    defaultCatalogUrl: BIZBUYSELL_CALIFORNIA_CATALOG_URL,
    notes: "HTTP catalog walk + ingest; optional fixtures",
    ingestSupported: true,
    browserRequired: false,
    fixturesSupported: true,
  },
  {
    id: "businessbroker",
    label: "BusinessBroker.net",
    defaultCatalogUrl: BUSINESSBROKER_CALIFORNIA_CATALOG_URL,
    notes: "HTTP catalog walk + ingest",
    ingestSupported: true,
    browserRequired: false,
    fixturesSupported: false,
  },
  {
    id: "dealstream",
    label: "DealStream",
    defaultCatalogUrl: DEALSTREAM_CALIFORNIA_CATALOG_URL,
    notes: "Playwright catalog + ingest",
    ingestSupported: true,
    browserRequired: true,
    fixturesSupported: false,
  },
  {
    id: "loopnet",
    label: "LoopNet (biz)",
    defaultCatalogUrl: LOOPNET_CALIFORNIA_CATALOG_URL,
    notes: "Playwright discovery only (ingest TBD)",
    ingestSupported: false,
    browserRequired: true,
    fixturesSupported: false,
  },
  {
    id: "businessesforsale",
    label: "BusinessesForSale.com",
    defaultCatalogUrl: BUSINESSES_FOR_SALE_CALIFORNIA_CATALOG_URL,
    notes: "Playwright discovery only (ingest TBD)",
    ingestSupported: false,
    browserRequired: true,
    fixturesSupported: false,
  },
] as const;

export function isCatalogSourceId(id: string): id is CatalogSourceId {
  return (CATALOG_SOURCE_IDS as readonly string[]).includes(id);
}

export function getCatalogSource(id: string): CatalogSourceDefinition | null {
  return CATALOG_SOURCES.find((s) => s.id === id) ?? null;
}

export function requireCatalogSource(id: string): CatalogSourceDefinition {
  const source = getCatalogSource(id);
  if (!source) {
    throw new Error(
      `Unknown catalog source "${id}". Use one of: ${CATALOG_SOURCE_IDS.join(", ")}`,
    );
  }
  return source;
}

/** Resolve catalog URL from `--source` or positional URL. */
export function resolveCatalogUrl(
  sourceId: string | undefined,
  positionalUrl: string | undefined,
): string {
  if (positionalUrl?.trim()) return positionalUrl.trim();
  if (sourceId) return requireCatalogSource(sourceId).defaultCatalogUrl;
  return CATALOG_SOURCES[0]?.defaultCatalogUrl;
}

export function catalogSourceForUrl(
  catalogUrl: string,
): CatalogSourceDefinition {
  const adapter = catalogAdapterFromUrl(catalogUrl);
  const known = getCatalogSource(adapter);
  if (known) return known;
  throw new Error(
    `Unsupported catalog URL for a registered source (adapter=${adapter}): ${catalogUrl}`,
  );
}

export function formatCatalogSourcesTable(): string {
  const lines = [
    "Catalog sources (use --source <id> or pass a catalog URL):",
    "",
    "  id                  ingest  browser  default catalog",
    "  ─────────────────── ─────── ──────── ─────────────────────────────",
  ];
  for (const s of CATALOG_SOURCES) {
    const ingest = s.ingestSupported ? "yes" : "no ";
    const browser = s.browserRequired ? "yes" : "no ";
    lines.push(
      `  ${s.id.padEnd(19)} ${ingest}     ${browser}      ${s.defaultCatalogUrl}`,
    );
  }
  return lines.join("\n");
}
