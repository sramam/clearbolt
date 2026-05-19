import type { SourceRecord } from "@clearbolt/core";
import { llmDedupSimilarityOpenRouter } from "./scorer-llm-openrouter.js";

export interface ScoreResult {
  overall: number;
  breakdown: Record<string, number>;
}

function hasPairBodyEmbeddings(a: SourceRecord, b: SourceRecord): boolean {
  const ea = a.bodyEmbedding;
  const eb = b.bodyEmbedding;
  return (
    Array.isArray(ea) &&
    Array.isArray(eb) &&
    ea.length > 0 &&
    ea.length === eb.length
  );
}

/** Cosine similarity in [-1, 1] for equal-length non-zero vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/** Map cosine to [0, 1] for compositional scoring. */
export function scorePairBodyEmbedding(
  a: SourceRecord,
  b: SourceRecord,
): number {
  if (!hasPairBodyEmbeddings(a, b)) return 0.5;
  const ea = a.bodyEmbedding;
  const eb = b.bodyEmbedding;
  if (!ea || !eb) return 0.5;
  const c = cosineSimilarity(ea, eb);
  return Math.min(1, Math.max(0, (c + 1) / 2));
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

/** V0 compositional score [0,1]. When both records carry `bodyEmbedding` (same dim), blends cosine similarity. */
export function scorePair(a: SourceRecord, b: SourceRecord): ScoreResult {
  const lexical = scorePairLexical(a, b);
  const numeric = scorePairNumeric(a, b);
  const geo = scorePairGeo(a, b);
  const embedding = scorePairBodyEmbedding(a, b);
  if (!hasPairBodyEmbeddings(a, b)) {
    const weights = { lexical: 0.45, numeric: 0.25, geo: 0.3 };
    const overall =
      weights.lexical * lexical + weights.numeric * numeric + weights.geo * geo;
    return {
      overall,
      breakdown: { lexical, numeric, geo },
    };
  }
  const weights = {
    lexical: 0.32,
    numeric: 0.18,
    geo: 0.15,
    embedding: 0.35,
  };
  const overall =
    weights.lexical * lexical +
    weights.numeric * numeric +
    weights.geo * geo +
    weights.embedding * embedding;
  return {
    overall,
    breakdown: { lexical, numeric, geo, embedding },
  };
}

/**
 * Programmatic score plus optional OpenRouter LLM blend when `OPENROUTER_API_KEY` is set.
 * `CLEARBOLT_DEDUP_LLM_WEIGHT` (default 0.3) controls how much the LLM moves the overall score.
 */
export async function scorePairAsync(
  a: SourceRecord,
  b: SourceRecord,
): Promise<ScoreResult> {
  const base = scorePair(a, b);
  const llm = await llmDedupSimilarityOpenRouter(a, b);
  if (llm === null) return base;

  const w = Number.parseFloat(process.env.CLEARBOLT_DEDUP_LLM_WEIGHT ?? "0.3");
  const lw = Math.min(0.75, Math.max(0, Number.isFinite(w) ? w : 0.3));
  const overall = (1 - lw) * base.overall + lw * llm;
  return {
    overall,
    breakdown: { ...base.breakdown, llm },
  };
}

export type MergeAction = "auto_merge" | "review" | "new";

export function mergeDecide(score: number): MergeAction {
  if (score >= 0.85) return "auto_merge";
  if (score >= 0.55) return "review";
  return "new";
}
