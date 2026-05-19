import type { PaginationStrategy } from "./types.js";

/** Try strategies in order; first non-null next URL wins. */
export function discoverNextPageUrl(
  html: string,
  currentUrl: string,
  strategies: readonly PaginationStrategy[],
): string | null {
  for (const strategy of strategies) {
    const next = strategy.findNext(html, currentUrl);
    if (next) return next;
  }
  return null;
}
