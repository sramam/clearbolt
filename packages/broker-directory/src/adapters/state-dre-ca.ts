import type { BrokerDirectoryRef } from "@clearbolt/scraper";
import { mergeBrokerDirectoryRef } from "@clearbolt/scraper";
import * as cheerio from "cheerio";

export const CA_DRE_PPL_SEARCH_URL =
  "https://www2.dre.ca.gov/PublicASP/pplinfo.asp?start=1";

export type CaDreSearchParams = {
  licenseeName?: string;
  cityState?: string;
  licenseId?: string;
};

export function buildCaDreSearchBody(
  params: CaDreSearchParams,
): URLSearchParams {
  return new URLSearchParams({
    h_nextstep: "SEARCH",
    LICENSEE_NAME: params.licenseeName ?? "",
    CITY_STATE: params.cityState ?? "",
    LICENSE_ID: params.licenseId ?? "",
  });
}

/** Parse DRE public license search results HTML (when results table is returned). */
export function discoverCaDreBrokerRefsFromResultsHtml(
  html: string,
): BrokerDirectoryRef[] {
  const $ = cheerio.load(html);
  const merged = new Map<string, BrokerDirectoryRef>();

  $("a[href*='ppldetail']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const profileUrl = new URL(href, CA_DRE_PPL_SEARCH_URL).toString();
    const name = $(el).text().trim();
    const row = $(el).closest("tr");
    const cells = row
      .find("td")
      .toArray()
      .map((td) => $(td).text().trim());
    const licenseId = cells.find((c) => /^\d{8}$/.test(c));
    mergeBrokerDirectoryRef(merged, {
      profileUrl,
      externalBrokerId: licenseId,
      name: name || undefined,
      firm: cells[1],
      state: "CA",
      city: cells
        .find((c) => /,/.test(c))
        ?.split(",")[0]
        ?.trim(),
      sourceAdapter: "state-dre-ca",
    });
  });

  return [...merged.values()];
}

export async function fetchCaDreBrokerRefs(
  params: CaDreSearchParams,
  options?: {
    fetchText?: (url: string, init?: RequestInit) => Promise<string>;
  },
): Promise<BrokerDirectoryRef[]> {
  const fetchText =
    options?.fetchText ??
    (async (url: string, init?: RequestInit) => {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent":
            "Clearbolt/1.0 (broker-directory; +https://clearbolt.dev)",
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
      if (!res.ok) {
        throw new Error(`CA DRE fetch failed ${res.status}`);
      }
      return res.text();
    });

  const body = buildCaDreSearchBody(params);
  const html = await fetchText(CA_DRE_PPL_SEARCH_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return discoverCaDreBrokerRefsFromResultsHtml(html);
}
