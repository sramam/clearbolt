import { createHash } from "node:crypto";

function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Visible-ish plain text from listing HTML (scripts/styles stripped), lowercased for fingerprints. */
export function htmlListingBodyText(html: string): string {
  return stripHtmlToPlainText(html).toLowerCase();
}

/** Plain text for LLM prompts (preserves case; optional max length). */
export function htmlListingBodyPlainText(
  html: string,
  maxLen?: number,
): string {
  const text = stripHtmlToPlainText(html);
  if (maxLen !== undefined && text.length > maxLen) {
    return text.slice(0, maxLen);
  }
  return text;
}

/**
 * Stable fingerprint of visible-ish text in listing HTML (scripts/styles stripped).
 * Used for same-URL re-scrape update detection and optional embedding input.
 */
export function htmlListingBodyFingerprint(html: string): string {
  const text = htmlListingBodyText(html);
  return createHash("sha256").update(text, "utf8").digest("hex");
}
