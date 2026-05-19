import {
  isBizBuySellBrokerProfileUrl,
  normalizeBizBuySellBrokerProfileUrl,
} from "./bizbuysell-broker-url.js";

/** One broker firm/person entry from a directory or profile page. */
export type BrokerDirectoryRef = {
  profileUrl: string;
  externalBrokerId?: string;
  name?: string;
  firm?: string;
  state?: string;
  city?: string;
  /** ISO-style country code when known (e.g. US, CA for Canada). */
  country?: string;
  sourceAdapter: string;
  websiteDomain?: string;
  phone?: string;
  email?: string;
  designations?: string[];
};

export function extractBizBuySellBrokerIdFromPathname(
  pathname: string,
): string | undefined {
  const m = pathname.match(/\/business-broker\/[^/]+\/[^/]+\/(\d+)\/?$/i);
  return m?.[1];
}

export function brokerDirectoryRefFromBizBuySellProfileUrl(
  url: string,
  extras?: Pick<BrokerDirectoryRef, "name" | "firm" | "state">,
): BrokerDirectoryRef | null {
  const profileUrl = normalizeBizBuySellBrokerProfileUrl(url);
  if (!profileUrl) return null;
  const pathname = new URL(profileUrl).pathname;
  return {
    profileUrl,
    externalBrokerId: extractBizBuySellBrokerIdFromPathname(pathname),
    sourceAdapter: "bizbuysell",
    ...extras,
  };
}

export function mergeBrokerDirectoryRef(
  merged: Map<string, BrokerDirectoryRef>,
  ref: BrokerDirectoryRef,
): void {
  const key = ref.externalBrokerId ?? ref.profileUrl;
  const existing = merged.get(key);
  if (!existing) {
    merged.set(key, ref);
    return;
  }
  merged.set(key, {
    ...existing,
    ...ref,
    profileUrl: existing.profileUrl || ref.profileUrl,
    name: ref.name ?? existing.name,
    firm: ref.firm ?? existing.firm,
    state: ref.state ?? existing.state,
    city: ref.city ?? existing.city,
    country: ref.country ?? existing.country,
    websiteDomain: ref.websiteDomain ?? existing.websiteDomain,
    phone: ref.phone ?? existing.phone,
    email: ref.email ?? existing.email,
    designations: ref.designations?.length
      ? ref.designations
      : existing.designations,
  });
}

export function discoverBizBuySellBrokerRefsFromHtml(
  html: string,
): BrokerDirectoryRef[] {
  const merged = new Map<string, BrokerDirectoryRef>();
  const re = /href=["']([^"']*\/business-broker\/[^"']+)["']/gi;
  let m: RegExpExecArray | null = re.exec(html);
  while (m !== null) {
    try {
      const href = m[1];
      if (!href) {
        m = re.exec(html);
        continue;
      }
      const abs = new URL(href, "https://www.bizbuysell.com").toString();
      if (!isBizBuySellBrokerProfileUrl(abs)) {
        m = re.exec(html);
        continue;
      }
      const ref = brokerDirectoryRefFromBizBuySellProfileUrl(abs);
      if (ref) mergeBrokerDirectoryRef(merged, ref);
    } catch {
      /* skip */
    }
    m = re.exec(html);
  }
  return [...merged.values()];
}
