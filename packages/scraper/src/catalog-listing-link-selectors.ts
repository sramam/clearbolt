/** Per-host Playwright wait selectors for catalog/search listing anchors. */

const HOST_SELECTORS: ReadonlyArray<{ hostSuffix: string; selector: string }> = [
  {
    hostSuffix: "bizbuysell.com",
    selector:
      'a[href*="/business-for-sale/"], a[href*="/business-opportunity/"], a[href*="-business-for-sale/"]',
  },
  {
    hostSuffix: "dealstream.com",
    selector: 'a[href*="/d/biz-sale/"]',
  },
  {
    hostSuffix: "loopnet.com",
    selector:
      'a[href*="/biz/business-opportunity/"], a[href*="/biz/business-for-sale/"], a[href*="/Listing/"]',
  },
  {
    hostSuffix: "businessesforsale.com",
    selector: 'a[href$=".aspx"]',
  },
  {
    hostSuffix: "businessbroker.net",
    selector: 'a[href*="/business-for-sale/"]',
  },
];

const DEFAULT_SELECTOR =
  'a[href*="/business-for-sale/"], a[href*="/business-opportunity/"], a[href*="-business-for-sale/"], a[href*="/d/biz-sale/"], a[href*="/Listing/"], a[href*="/biz/business-opportunity/"], a[href*="/biz/business-for-sale/"]';

export function listingLinkSelectorForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const { hostSuffix, selector } of HOST_SELECTORS) {
      if (host === hostSuffix || host.endsWith(`.${hostSuffix}`)) {
        return selector;
      }
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_SELECTOR;
}
