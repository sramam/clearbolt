import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawResponse } from "@clearbolt/core";
import { MockFetcher } from "../mock-fetcher.js";

const _dir = dirname(fileURLToPath(import.meta.url));

export const BIZQUEST_FIXTURE_SEARCH_URL =
  "https://www.bizquest.com/businesses-for-sale-in-midwest-region/";

export function defaultBizQuestFixtureRoot(): string {
  return join(_dir, "..", "..", "tests", "fixtures");
}

export type BizQuestFixtureBundle = {
  fetcher: MockFetcher;
  fixtureSearchUrl: string;
};

export async function buildBizQuestFixtureFetcher(
  root = defaultBizQuestFixtureRoot(),
): Promise<BizQuestFixtureBundle> {
  const search = await readFile(join(root, "bizquest-search.html"), "utf8");
  const listing = await readFile(
    join(root, "bizquest-listing-BW2486214.html"),
    "utf8",
  );
  const listingUrl =
    "https://www.bizquest.com/business-for-sale/pizza-franchise-nets-145-000-owner-operator-160k-dn-rent-1-413-mo/BW2486214/";
  const map = new Map<string, RawResponse>();
  map.set(BIZQUEST_FIXTURE_SEARCH_URL, {
    status: 200,
    body: search,
    finalUrl: BIZQUEST_FIXTURE_SEARCH_URL,
    headers: {},
  });
  map.set(listingUrl, {
    status: 200,
    body: listing,
    finalUrl: listingUrl,
    headers: {},
  });
  return {
    fetcher: new MockFetcher(map),
    fixtureSearchUrl: BIZQUEST_FIXTURE_SEARCH_URL,
  };
}
