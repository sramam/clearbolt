/** Strip hash; used for next-page URL comparison and storage. */
export function normalizePageUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.toString();
}

export function normalizeUrlForCompare(u: string): string {
  return normalizePageUrl(u);
}
