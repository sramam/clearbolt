import type { ListingRef } from "@clearbolt/core";

export type JsonLdListingDiscoveryOptions = {
  /** Only keep URLs that pass this filter (e.g. host / path rules). */
  urlMatches?: (url: string) => boolean;
  /** Normalize URL before dedupe (e.g. mobile → desktop). */
  normalizeUrl?: (url: string) => string;
  /** Extract listing external id from normalized URL. */
  externalIdFromUrl?: (url: string) => string | undefined;
};

/** Extract listing refs from JSON-LD ItemList / nested url fields when present. */
export function discoverListingRefsFromJsonLd(
  html: string,
  options: JsonLdListingDiscoveryOptions = {},
): ListingRef[] {
  const refs: ListingRef[] = [];
  const seen = new Set<string>();
  const urlMatches = options.urlMatches ?? (() => true);
  const normalizeUrl = options.normalizeUrl ?? ((u: string) => u);
  const externalIdFromUrl =
    options.externalIdFromUrl ??
    ((u: string) => u.match(/(\d{6,})/)?.[1]);

  const scripts = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (!scripts) return refs;

  for (const block of scripts) {
    const inner = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
    let data: unknown;
    try {
      data = JSON.parse(inner);
    } catch {
      continue;
    }
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      const obj = node as Record<string, unknown>;
      const type = String(obj["@type"] ?? "");
      if (type === "ItemList" && Array.isArray(obj.itemListElement)) {
        for (const el of obj.itemListElement) {
          visit(el);
        }
      }
      if (obj.item && typeof obj.item === "object") {
        visit(obj.item);
      }
      const rawUrl =
        typeof obj.url === "string"
          ? obj.url
          : typeof obj["@id"] === "string"
            ? obj["@id"]
            : null;
      if (rawUrl && urlMatches(rawUrl)) {
        try {
          const desktop = normalizeUrl(rawUrl);
          if (!urlMatches(desktop)) return;
          const idFromProduct =
            obj.productId != null && String(obj.productId).trim() !== ""
              ? String(obj.productId)
              : undefined;
          const id = idFromProduct ?? externalIdFromUrl(desktop);
          const dedupeKey = id ?? desktop;
          if (id && !seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            refs.push({ url: desktop, externalId: id });
          }
        } catch {
          /* ignore bad url */
        }
      }
      for (const v of Object.values(obj)) {
        if (v && typeof v === "object") visit(v);
      }
    };
    visit(data);
  }
  return refs;
}
