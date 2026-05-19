import type { BrokerDirectoryRef } from "@clearbolt/scraper";
import { mergeBrokerDirectoryRef } from "@clearbolt/scraper";
import * as cheerio from "cheerio";

export const AZ_ADRE_SEARCH_URL =
  "https://services.azre.gov/publicdatabase/SearchIndividuals.aspx";
export const AZ_ADRE_SEARCH_POST_URL =
  "https://services.azre.gov/PdbWeb/IndividualLicense/SearchIndividualLicenses";

export type AzDreSearchParams = {
  city?: string;
  lastName?: string;
  firstName?: string;
  licenseNo?: string;
};

export function extractAzRequestVerificationToken(html: string): string | null {
  const $ = cheerio.load(html);
  return (
    $('input[name="__RequestVerificationToken"]').attr("value") ??
    null
  );
}

export function discoverAzDreBrokerRefsFromResultsHtml(
  html: string,
): BrokerDirectoryRef[] {
  const $ = cheerio.load(html);
  const merged = new Map<string, BrokerDirectoryRef>();

  $("a[href*='IndividualLicense'], a[href*='LicenseDetail']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const profileUrl = new URL(href, "https://services.azre.gov").toString();
    const name = $(el).text().trim();
    const licenseMatch = $(el)
      .closest("tr")
      .text()
      .match(/\b(BR\d{5,}|\d{6,})\b/);
    mergeBrokerDirectoryRef(merged, {
      profileUrl,
      externalBrokerId: licenseMatch?.[1],
      name: name || undefined,
      state: "AZ",
      sourceAdapter: "state-dre-az",
    });
  });

  $("table tr").each((_, row) => {
    const text = $(row).text();
    const licenseMatch = text.match(/\b(BR\d{5,})\b/);
    if (!licenseMatch) return;
    const cells = $(row)
      .find("td")
      .toArray()
      .map((td) => $(td).text().trim());
    const name = cells.find((c) => c.length > 2 && !/^BR\d/.test(c));
    if (!name) return;
    mergeBrokerDirectoryRef(merged, {
      profileUrl: `${AZ_ADRE_SEARCH_POST_URL}#${licenseMatch[1]}`,
      externalBrokerId: licenseMatch[1],
      name,
      state: "AZ",
      city: cells.find((c) => /phoenix|scottsdale|tucson/i.test(c)),
      sourceAdapter: "state-dre-az",
    });
  });

  return [...merged.values()];
}

export async function fetchAzDreBrokerRefs(
  params: AzDreSearchParams,
): Promise<BrokerDirectoryRef[]> {
  const getRes = await fetch(AZ_ADRE_SEARCH_URL, {
    headers: { "User-Agent": "Clearbolt/1.0 (broker-directory)" },
  });
  if (!getRes.ok) {
    throw new Error(`AZ ADRE search page failed ${getRes.status}`);
  }
  const searchHtml = await getRes.text();
  const token = extractAzRequestVerificationToken(searchHtml);
  if (!token) {
    throw new Error("AZ ADRE: missing __RequestVerificationToken");
  }

  const body = new URLSearchParams({
    __RequestVerificationToken: token,
    LicenseNo: params.licenseNo ?? "",
    FirstName: params.firstName ?? "",
    LastName: params.lastName ?? "",
    City: params.city ?? "",
    Zip: "",
    County: "",
  });

  const postRes = await fetch(AZ_ADRE_SEARCH_POST_URL, {
    method: "POST",
    headers: {
      "User-Agent": "Clearbolt/1.0 (broker-directory)",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: getRes.headers.get("set-cookie") ?? "",
    },
    body,
  });
  if (!postRes.ok) {
    throw new Error(`AZ ADRE search POST failed ${postRes.status}`);
  }
  const html = await postRes.text();
  return discoverAzDreBrokerRefsFromResultsHtml(html);
}
