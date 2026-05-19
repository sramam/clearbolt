import {
  type BrokerDirectoryRef,
  discoverBizBuySellBrokerRefsFromHtml,
} from "../../broker-directory-ref.js";
import {
  type PaginationStrategy,
  discoverNextPageUrl,
  linkSelectorNextStrategy,
  normalizePageUrl,
  paginationNavNextStrategy,
  pathIncrementStrategy,
  queryPageStrategy,
  relNextStrategy,
} from "../../discovery/pagination/index.js";

export const BIZBUYSELL_CALIFORNIA_BROKER_DIRECTORY_URL =
  "https://www.bizbuysell.com/business-brokers/california/";

const BROKER_DIR_PATH = /^\/business-brokers\/[^/]+(?:\/\d+)?\/?$/i;
const PAGE_IN_PATH = /\/business-brokers\/[^/]+\/(\d+)\/?$/i;

export function isBizBuySellBrokerDirectoryUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("bizbuysell.com")) return false;
    if (!BROKER_DIR_PATH.test(u.pathname)) return false;
    if (/\/business-broker\//i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function brokerDirectorySlugFromPathname(
  pathname: string,
): string | null {
  const m = pathname.match(/^(\/business-brokers\/[^/]+)(?:\/\d+)?\/?$/i);
  return m?.[1] ?? null;
}

export function brokerDirectoryPageNumberFromPathname(
  pathname: string,
): number {
  const m = pathname.match(PAGE_IN_PATH);
  if (m) {
    const pageRaw = m[1];
    if (pageRaw !== undefined) {
      const n = Number.parseInt(pageRaw, 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  if (/^\/business-brokers\/[^/]+\/?$/i.test(pathname)) return 1;
  return 1;
}

export function buildBrokerDirectoryPageUrl(
  base: URL,
  pageNum: number,
): string {
  const slug = brokerDirectorySlugFromPathname(base.pathname);
  if (!slug) return normalizePageUrl(base.toString());
  const u = new URL(base);
  u.pathname = pageNum <= 1 ? `${slug}/` : `${slug}/${pageNum}/`;
  u.search = "";
  return normalizePageUrl(u.toString());
}

export function recoverBrokerDirectoryPageUrl(
  directoryBaseUrl: string,
  pageNumber: number,
): string {
  return buildBrokerDirectoryPageUrl(new URL(directoryBaseUrl), pageNumber);
}

export function normalizeBrokerDirectoryUrlForCompare(url: string): string {
  const base = new URL(url);
  const slug = brokerDirectorySlugFromPathname(base.pathname);
  if (!slug) return normalizePageUrl(url);
  const page = brokerDirectoryPageNumberFromPathname(base.pathname);
  base.pathname = page <= 1 ? `${slug}/` : `${slug}/${page}/`;
  base.search = "";
  return normalizePageUrl(base.toString());
}

const brokerDirPathPagination = pathIncrementStrategy({
  id: "bizbuysell-broker-dir-path",
  catalogPathPattern: /^\/business-brokers\/[^/]+(?:\/\d+)?\/?$/i,
  pageFromPathname: brokerDirectoryPageNumberFromPathname,
  pageFromLinkPathname: (pathname) => {
    const m = pathname.match(PAGE_IN_PATH);
    if (!m) return null;
    const pageRaw = m[1];
    if (pageRaw === undefined) return null;
    const n = Number.parseInt(pageRaw, 10);
    return Number.isNaN(n) ? null : n;
  },
  buildPageUrl: buildBrokerDirectoryPageUrl,
});

const brokerDirPagerLinkStrategy = linkSelectorNextStrategy({
  id: "bizbuysell-broker-dir-pager",
  selectors:
    "a.bbsPager_next[href], li.pagination-next:not(.disabled) a[href], a.next-page[href]",
});

export const bizBuySellBrokerDirectoryPaginationStrategies: readonly PaginationStrategy[] =
  [
    relNextStrategy,
    brokerDirPagerLinkStrategy,
    paginationNavNextStrategy,
    brokerDirPathPagination,
    queryPageStrategy,
  ];

export function discoverNextBizBuySellBrokerDirectoryPageUrl(
  html: string,
  currentUrl: string,
  options?: { directoryBaseUrl?: string; currentPageNumber?: number },
): string | null {
  const urlForPagination =
    brokerDirectorySlugFromPathname(new URL(currentUrl).pathname) != null
      ? currentUrl
      : options?.directoryBaseUrl && options.currentPageNumber
        ? recoverBrokerDirectoryPageUrl(
            options.directoryBaseUrl,
            options.currentPageNumber,
          )
        : currentUrl;

  const fromStrategies = discoverNextPageUrl(
    html,
    urlForPagination,
    bizBuySellBrokerDirectoryPaginationStrategies,
  );
  if (fromStrategies && isBizBuySellBrokerDirectoryUrl(fromStrategies)) {
    const samePage =
      normalizeBrokerDirectoryUrlForCompare(fromStrategies) ===
      normalizeBrokerDirectoryUrlForCompare(urlForPagination);
    if (!samePage) return fromStrategies;
  }

  const slug = brokerDirectorySlugFromPathname(
    new URL(urlForPagination).pathname,
  );
  if (!slug) return null;
  const current = brokerDirectoryPageNumberFromPathname(
    new URL(urlForPagination).pathname,
  );
  if (/business-broker\//i.test(html)) {
    return buildBrokerDirectoryPageUrl(new URL(urlForPagination), current + 1);
  }
  return null;
}

export function discoverBrokerRefsFromBizBuySellDirectoryPage(
  html: string,
  _pageUrl: string,
): BrokerDirectoryRef[] {
  return discoverBizBuySellBrokerRefsFromHtml(html);
}
