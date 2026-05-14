export type WafClass = "ok" | "challenge" | "block" | "rate_limited";

export function classifyWaf(status: number, body: string): WafClass {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "challenge";
  const lower = body.slice(0, 8000).toLowerCase();
  if (
    lower.includes("akamai") ||
    lower.includes("access denied") ||
    lower.includes("captcha") ||
    lower.includes("cf-browser-verification")
  ) {
    return status >= 400 ? "challenge" : "ok";
  }
  if (status >= 500) return "block";
  return "ok";
}
