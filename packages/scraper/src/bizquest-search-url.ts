const SEARCH_PATH =
  /^\/(businesses-for-sale(?:-in-[^/]+)?|buy-a-business-for-sale)(?:\/page-\d+)?\/?$/i;

export function isBizQuestHost(hostname: string): boolean {
  return hostname.toLowerCase().includes("bizquest.com");
}

export function isBizQuestSearchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!isBizQuestHost(u.hostname)) return false;
    if (isBizQuestListingPathname(u.pathname)) return false;
    return SEARCH_PATH.test(u.pathname) || u.pathname === "/";
  } catch {
    return false;
  }
}

function isBizQuestListingPathname(pathname: string): boolean {
  return /\/(business-for-sale|start-up-business)\/[^/]+\/BW\d+\/?$/i.test(
    pathname,
  );
}

export function parseBizQuestSearchPageNumber(pathname: string): number {
  const m = pathname.match(/\/page-(\d+)\/?$/i);
  if (!m) return 1;
  const pageRaw = m[1];
  if (pageRaw === undefined) return 1;
  const n = Number.parseInt(pageRaw, 10);
  return Number.isNaN(n) || n < 1 ? 1 : n;
}

/** Strip trailing `/page-N/` for pagination base path. */
export function bizQuestSearchPathBase(pathname: string): string {
  const stripped = pathname.replace(/\/page-\d+\/?$/i, "").replace(/\/$/, "");
  return stripped || "/";
}

export function buildBizQuestSearchPageUrl(
  searchUrl: string,
  page: number,
): string {
  const u = new URL(searchUrl);
  const base = bizQuestSearchPathBase(u.pathname);
  if (page <= 1) {
    u.pathname = `${base}/`;
    u.search = "";
    u.hash = "";
    return u.toString();
  }
  u.pathname = `${base}/page-${page}/`;
  u.search = "";
  u.hash = "";
  return u.toString();
}

export type BizQuestSavedSearchParams = {
  url: string;
  page: number;
};

export function parseBizQuestSearchUrl(url: string): BizQuestSavedSearchParams {
  const u = new URL(url);
  if (!isBizQuestHost(u.hostname)) {
    throw new Error(`not a BizQuest URL: ${url}`);
  }
  return {
    url: u.toString(),
    page: parseBizQuestSearchPageNumber(u.pathname),
  };
}

export function serializeBizQuestSearchUrl(
  params: BizQuestSavedSearchParams,
): string {
  return buildBizQuestSearchPageUrl(params.url, params.page);
}
