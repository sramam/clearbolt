import type { SourceRecord } from "@clearbolt/core";

export interface ScoreResult {
  overall: number;
  breakdown: Record<string, number>;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function scorePairLexical(a: SourceRecord, b: SourceRecord): number {
  const ta = a.parsedFields.title ?? "";
  const tb = b.parsedFields.title ?? "";
  return jaccard(tokenize(ta), tokenize(tb));
}

export function scorePairNumeric(a: SourceRecord, b: SourceRecord): number {
  const fields: (keyof Pick<
    typeof a.parsedFields,
    "askingPrice" | "revenue" | "cashFlow"
  >)[] = ["askingPrice", "revenue", "cashFlow"];
  let parts = 0;
  let sum = 0;
  for (const f of fields) {
    const va = a.parsedFields[f];
    const vb = b.parsedFields[f];
    if (typeof va === "number" && typeof vb === "number" && va > 0 && vb > 0) {
      parts++;
      const ratio = Math.min(va, vb) / Math.max(va, vb);
      sum += ratio;
    }
  }
  return parts === 0 ? 0.5 : sum / parts;
}

export function scorePairGeo(a: SourceRecord, b: SourceRecord): number {
  const sa = a.parsedFields.state ?? "";
  const sb = b.parsedFields.state ?? "";
  if (!sa || !sb) return 0.5;
  return sa === sb ? 1 : 0;
}

/** V0 compositional score [0,1] */
export function scorePair(a: SourceRecord, b: SourceRecord): ScoreResult {
  const lexical = scorePairLexical(a, b);
  const numeric = scorePairNumeric(a, b);
  const geo = scorePairGeo(a, b);
  const weights = { lexical: 0.45, numeric: 0.25, geo: 0.3 };
  const overall =
    weights.lexical * lexical + weights.numeric * numeric + weights.geo * geo;
  return {
    overall,
    breakdown: { lexical, numeric, geo },
  };
}

export type MergeAction = "auto_merge" | "review" | "new";

export function mergeDecide(score: number): MergeAction {
  if (score >= 0.85) return "auto_merge";
  if (score >= 0.55) return "review";
  return "new";
}
