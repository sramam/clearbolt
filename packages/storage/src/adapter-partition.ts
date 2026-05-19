import type { DedupKey } from "@clearbolt/core";

const HOST_TO_ADAPTER: Record<string, string> = {
  "bizbuysell.com": "bizbuysell",
  "m.bizbuysell.com": "bizbuysell",
  "bizben.com": "bizben",
  "www.bizben.com": "bizben",
  "businessbroker.net": "businessbroker",
  "bizquest.com": "bizquest",
  "www.bizquest.com": "bizquest",
  "dealstream.com": "dealstream",
  "loopnet.com": "loopnet",
  "www.loopnet.com": "loopnet",
  "businessesforsale.com": "businessesforsale",
  "us.businessesforsale.com": "businessesforsale",
  "www.businessesforsale.com": "businessesforsale",
};

/** Map marketplace host → adapter id (fallback: normalized host). */
export function hostToAdapter(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  return HOST_TO_ADAPTER[host.toLowerCase()] ?? HOST_TO_ADAPTER[h] ?? h;
}

/** Adapter scope for a dedup key (used to partition on-disk indexes). */
export function dedupKeyAdapter(key: DedupKey): string {
  if (key.kind === "external") return key.adapter;
  if (key.kind === "broker-listing") {
    const slash = key.brokerKey.indexOf("/");
    if (slash > 0) return key.brokerKey.slice(0, slash);
    return key.brokerKey;
  }
  try {
    return hostToAdapter(new URL(key.value).hostname);
  } catch {
    return "unknown";
  }
}
