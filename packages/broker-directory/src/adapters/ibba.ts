import type { BrokerDirectoryRef } from "@clearbolt/scraper";
import { mergeBrokerDirectoryRef } from "@clearbolt/scraper";
import { slugifySegment, websiteDomainFromUrl } from "../website-domain.js";

export const IBBA_BROKERS_ALL_URL = "https://www.ibba.org/wp-json/brokers/all";
export const IBBA_BROKERS_SEARCH_URL = "https://www.ibba.org/wp-json/brokers/search";
export const IBBA_BROKERS_US_STATE_URL =
  "https://www.ibba.org/wp-json/brokers/usstatebrokers";

export type IbbaBrokerRecord = {
  id: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  company?: string | null;
  email?: string | null;
  website?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  state_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  cbi_cert?: string | number | null;
  mami_cert?: string | number | null;
  master_cert?: string | number | null;
  permalink?: string | null;
};

export type IbbaSearchPost = {
  first_name?: string[];
  last_name?: string[];
  company?: string[];
  permalink?: string;
  state?: string[];
  city?: string[];
};

function ibbaDesignations(record: IbbaBrokerRecord): string[] | undefined {
  const out: string[] = [];
  if (record.cbi_cert === "1" || record.cbi_cert === 1) out.push("CBI");
  if (record.mami_cert === "1" || record.mami_cert === 1) out.push("M&AMI");
  if (record.master_cert === "1" || record.master_cert === 1) out.push("MCBI");
  return out.length ? out : undefined;
}

export function ibbaProfileUrlFromRecord(record: IbbaBrokerRecord): string {
  if (record.permalink?.trim()) return record.permalink.trim();
  const stateSeg = slugifySegment(record.state ?? record.state_code ?? "us");
  const citySeg = slugifySegment(record.city ?? "unknown");
  const nameSeg = slugifySegment(
    `${record.first_name} ${record.last_name}`,
  );
  return `https://www.ibba.org/broker-profile/${stateSeg}/${citySeg}/${nameSeg}/`;
}

export function ibbaRecordToBrokerDirectoryRef(
  record: IbbaBrokerRecord,
): BrokerDirectoryRef {
  const name = [record.first_name, record.middle_name, record.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const website = record.website?.trim() || undefined;
  return {
    profileUrl: ibbaProfileUrlFromRecord(record),
    externalBrokerId: record.id,
    name: name || undefined,
    firm: record.company?.trim() || undefined,
    state: record.state_code?.trim() || record.state?.trim() || undefined,
    city: record.city?.trim() || undefined,
    country: normalizeIbbaCountryCode(record.country_code ?? record.country),
    sourceAdapter: "ibba",
    websiteDomain: websiteDomainFromUrl(website),
    phone: record.phone?.trim() || undefined,
    email: record.email?.trim() || undefined,
    designations: ibbaDesignations(record),
  };
}

export function parseIbbaBrokersAllJson(json: unknown): BrokerDirectoryRef[] {
  if (!Array.isArray(json)) {
    throw new Error("IBBA /brokers/all response is not an array");
  }
  const merged = new Map<string, BrokerDirectoryRef>();
  for (const row of json) {
    const ref = ibbaRecordToBrokerDirectoryRef(row as IbbaBrokerRecord);
    mergeBrokerDirectoryRef(merged, ref);
  }
  return [...merged.values()];
}

export function parseIbbaSearchPostsJson(json: unknown): BrokerDirectoryRef[] {
  const posts = (json as { posts?: IbbaSearchPost[] })?.posts;
  if (!Array.isArray(posts)) {
    throw new Error("IBBA /brokers/search response missing posts array");
  }
  const merged = new Map<string, BrokerDirectoryRef>();
  for (const post of posts) {
    const record: IbbaBrokerRecord = {
      id: "",
      first_name: post.first_name?.[0] ?? "",
      last_name: post.last_name?.[0] ?? "",
      company: post.company?.[0] ?? null,
      city: post.city?.[0] ?? null,
      state: post.state?.[0] ?? null,
      permalink: post.permalink,
    };
    const idField = (post as { id?: string[] }).id?.[0];
    record.id =
      idField ??
      post.permalink?.split("/").filter(Boolean).pop() ??
      `${record.first_name}-${record.last_name}`;
    mergeBrokerDirectoryRef(merged, ibbaRecordToBrokerDirectoryRef(record));
  }
  return [...merged.values()];
}

export function parseIbbaUsStateBrokersGeoJson(json: unknown): BrokerDirectoryRef[] {
  const features = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) {
    throw new Error("IBBA usstatebrokers response missing features");
  }
  const merged = new Map<string, BrokerDirectoryRef>();
  for (const feature of features) {
    const details = (feature as { details?: Record<string, string> }).details;
    if (!details?.url) continue;
    const name = details.name?.trim() ?? "";
    const parts = name.split(/\s+/);
    const record: IbbaBrokerRecord = {
      id: details.url,
      first_name: parts[0] ?? "",
      last_name: parts.slice(1).join(" ") || "",
      company: details.company ?? null,
      city: details.city ?? null,
      state: details.state ?? null,
      state_code: details.state?.length === 2 ? details.state : undefined,
      permalink: details.url,
      cbi_cert: details.cbi === "1" ? 1 : 0,
      master_cert: details.master_cbi === "1" ? 1 : 0,
      mami_cert: details.mami === "1" ? 1 : 0,
    };
    mergeBrokerDirectoryRef(merged, ibbaRecordToBrokerDirectoryRef(record));
  }
  return [...merged.values()];
}

/** Normalize CLI/API country input to IBBA `country_code` (US, CA, AU, …). */
export function normalizeIbbaCountryCode(
  input: string | null | undefined,
): string | undefined {
  if (!input?.trim()) return undefined;
  const v = input.trim().toUpperCase();
  if (v === "USA" || v === "UNITED STATES" || v === "UNITED STATES OF AMERICA") {
    return "US";
  }
  if (v === "CANADA" || v === "CAN") return "CA";
  if (v === "UK" || v === "UNITED KINGDOM" || v === "GBR") return "GB";
  if (v.length === 2) return v;
  return v.slice(0, 2);
}

export function filterIbbaBrokerRefs(
  refs: BrokerDirectoryRef[],
  options: { countryCode?: string; stateCode?: string },
): BrokerDirectoryRef[] {
  let out = refs;
  if (options.countryCode) {
    const cc = normalizeIbbaCountryCode(options.countryCode)!;
    out = out.filter((r) => (r.country ?? "").toUpperCase() === cc);
  }
  if (options.stateCode) {
    const sc = options.stateCode.toUpperCase();
    out = out.filter((r) => (r.state ?? "").toUpperCase() === sc);
  }
  return out;
}

export type FetchIbbaBrokersOptions = {
  /** US/CA/etc. `country_code` from IBBA (`CA` = Canada, not California). */
  countryCode?: string;
  /** US state / CA province code in `state_code` (e.g. CA = California when country is US). */
  stateCode?: string;
  fetchJson?: (url: string) => Promise<unknown>;
};

export async function fetchIbbaBrokerRefs(
  options: FetchIbbaBrokersOptions = {},
): Promise<BrokerDirectoryRef[]> {
  const fetchJson =
    options.fetchJson ??
    (async (url: string) => {
      const res = await fetch(url, {
        headers: { "User-Agent": "Clearbolt/1.0 (broker-directory; +https://clearbolt.dev)" },
      });
      if (!res.ok) {
        throw new Error(`IBBA fetch failed ${res.status}: ${url}`);
      }
      return res.json() as Promise<unknown>;
    });

  const all = parseIbbaBrokersAllJson(await fetchJson(IBBA_BROKERS_ALL_URL));
  if (!options.countryCode && !options.stateCode) {
    return all;
  }
  return filterIbbaBrokerRefs(all, {
    countryCode: options.countryCode,
    stateCode: options.stateCode,
  });
}
