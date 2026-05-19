/** Registrable domain for allow-list / dedup (strips www). */
export function websiteDomainFromUrl(url: string | null | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const host = new URL(url.trim()).hostname.replace(/^www\./i, "").toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}

export function slugifySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
