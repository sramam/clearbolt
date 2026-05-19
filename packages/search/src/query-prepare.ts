/** Common ETA / SMB search typos and shorthand → canonical tokens. */
const TOKEN_CORRECTIONS: Record<string, string> = {
  manufacuring: "manufacturing",
  manufaturing: "manufacturing",
  resturant: "restaurant",
  restaraunt: "restaurant",
  saas: "software",
  b2b: "business",
  hvac: "heating cooling",
  laundromat: "laundry",
  drycleaning: "dry cleaning",
  ecommerce: "ecommerce online",
  ecom: "ecommerce",
};

/** Optional OR expansions (first token only) for FTS breadth. */
const TOKEN_EXPANSIONS: Record<string, string[]> = {
  manufacturing: ["industrial", "factory"],
  restaurant: ["food", "dining"],
  software: ["saas", "technology"],
  healthcare: ["medical", "clinic"],
  logistics: ["transport", "trucking"],
  cleaning: ["janitorial", "maintenance"],
};

export interface PreparedSearchQuery {
  raw: string;
  /** Tokens after normalization and typo correction (for BizBuySell `q`). */
  searchKeywords: string;
  /** Whitespace-separated tokens after correction (for OR / highlight matching). */
  tokens: string[];
  /** Passed to Postgres `websearch_to_tsquery('english', …)` (strict AND-style). */
  ftsQuery: string;
  /** OR across tokens — used when strict FTS returns few rows (Google-style broadening). */
  ftsQueryRelaxed: string;
  /** Single string for pg_trgm similarity fallback. */
  trgmQuery: string;
  /** True when any token was corrected or expanded. */
  didExpand: boolean;
  /** Human-readable notes (e.g. "manufacuring → manufacturing"). */
  expansions: string[];
}

function normalizeToken(t: string): string {
  return t
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9'-]/g, "");
}

export function prepareSearchQuery(rawInput: string): PreparedSearchQuery {
  const raw = rawInput.trim();
  const expansions: string[] = [];
  if (!raw) {
    return {
      raw: "",
      searchKeywords: "",
      tokens: [],
      ftsQuery: "",
      ftsQueryRelaxed: "",
      trgmQuery: "",
      didExpand: false,
      expansions: [],
    };
  }

  const tokens = raw
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);

  const corrected: string[] = [];
  const ftsParts: string[] = [];

  for (const token of tokens) {
    const fixed = TOKEN_CORRECTIONS[token] ?? token;
    if (fixed !== token) {
      expansions.push(`${token} → ${fixed}`);
    }
    corrected.push(fixed);

    const extra = TOKEN_EXPANSIONS[fixed];
    if (extra?.length) {
      ftsParts.push(`(${[fixed, ...extra].join(" | ")})`);
      expansions.push(`${fixed} + ${extra.join(", ")}`);
    } else {
      ftsParts.push(fixed);
    }
  }

  const searchKeywords = corrected.join(" ");
  const ftsQuery = ftsParts.join(" ");
  const ftsQueryRelaxed =
    corrected.length > 1 ? corrected.join(" | ") : ftsQuery;
  const didExpand =
    expansions.length > 0 || searchKeywords.toLowerCase() !== raw.toLowerCase();

  return {
    raw,
    searchKeywords,
    tokens: corrected,
    ftsQuery,
    ftsQueryRelaxed,
    trgmQuery: searchKeywords,
    didExpand,
    expansions,
  };
}
