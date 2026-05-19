import type { BrokerDirectoryRef } from "@clearbolt/scraper";
import { mergeBrokerDirectoryRef } from "@clearbolt/scraper";
import * as cheerio from "cheerio";

export const FL_DBPR_LICENSE_SEARCH_URL =
  "https://www.myfloridalicense.com/wl11.asp?mode=0&SID=";

export type FlDreSearchParams = {
  /** Last name or partial — DBPR requires at least one criterion. */
  lastName?: string;
  city?: string;
  county?: string;
};

/**
 * Parse Florida DBPR license search results (table layout varies; matches common wl11 output).
 */
export function discoverFlDreBrokerRefsFromResultsHtml(
  html: string,
): BrokerDirectoryRef[] {
  const $ = cheerio.load(html);
  const merged = new Map<string, BrokerDirectoryRef>();

  $("table tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .toArray()
      .map((td) => $(td).text().replace(/\s+/g, " ").trim());
    if (cells.length < 3) return;
    const licenseCell = cells.find((c) => /^[A-Z]{2}\d{5,}/.test(c) || /^\d{5,}/.test(c));
    if (!licenseCell) return;
    const name = cells[0];
    if (!name || /name|license|search/i.test(name)) return;
    mergeBrokerDirectoryRef(merged, {
      profileUrl: `${FL_DBPR_LICENSE_SEARCH_URL}#${encodeURIComponent(licenseCell)}`,
      externalBrokerId: licenseCell,
      name,
      firm: cells[1],
      state: "FL",
      city: cells[2],
      sourceAdapter: "state-dre-fl",
    });
  });

  return [...merged.values()];
}

export async function fetchFlDreBrokerRefs(
  params: FlDreSearchParams,
): Promise<BrokerDirectoryRef[]> {
  if (!params.lastName?.trim() && !params.city?.trim()) {
    throw new Error(
      "Florida DBPR search requires --last-name or --city (bulk export via myfloridalicense.com public records is not automated yet)",
    );
  }
  const res = await fetch(FL_DBPR_LICENSE_SEARCH_URL, {
    method: "POST",
    headers: {
      "User-Agent": "Clearbolt/1.0 (broker-directory)",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      Board: "RE",
      RecsPerPage: "50",
      LName: params.lastName ?? "",
      City: params.city ?? "",
      County: params.county ?? "",
    }),
  });
  if (!res.ok) {
    throw new Error(`Florida DBPR fetch failed ${res.status}`);
  }
  const html = await res.text();
  return discoverFlDreBrokerRefsFromResultsHtml(html);
}
