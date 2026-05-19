export function buildSearchHref(parts: {
  source?: string;
  view?: string;
  q?: string;
  query?: string;
  extra?: Record<string, string>;
}): string {
  const u = new URLSearchParams();
  if (parts.source && parts.source !== "all") u.set("source", parts.source);
  if (parts.view && parts.view !== "grid") u.set("view", parts.view);
  const q = (parts.q ?? parts.query)?.trim();
  if (q) u.set("q", q);
  for (const [key, value] of Object.entries(parts.extra ?? {})) {
    if (value) u.set(key, value);
  }
  const s = u.toString();
  return s ? `/search?${s}` : "/search";
}
