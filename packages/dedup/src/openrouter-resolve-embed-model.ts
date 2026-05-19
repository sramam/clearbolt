/**
 * Resolve an OpenRouter embedding model: prefer zero-priced catalog entries, else cheapest paid.
 * @see https://openrouter.ai/docs/api/api-reference/embeddings/list-embeddings-models
 */

const EMBEDDINGS_MODELS_URL =
  "https://openrouter.ai/api/v1/embeddings/models" as const;

type OrEmbedModel = {
  id: string;
  pricing?: { prompt?: string | number; completion?: string | number };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

function parsePromptPricePerMillion(m: OrEmbedModel): number {
  const raw = m.pricing?.prompt;
  if (raw === undefined || raw === null) return Number.NaN;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  return Number.isFinite(n) ? n : Number.NaN;
}

function isFreeEmbedding(m: OrEmbedModel): boolean {
  return parsePromptPricePerMillion(m) === 0;
}

/** Text in → embeddings out (listing body is plain text). */
function isTextEmbeddingModel(m: OrEmbedModel): boolean {
  const outs = m.architecture?.output_modalities ?? [];
  const ins = m.architecture?.input_modalities ?? [];
  return outs.includes("embeddings") && ins.includes("text");
}

/**
 * Prefer these free slugs when present (order = priority).
 * Refreshed from OpenRouter periodically; update when catalog rotates.
 */
export const DEDUP_FREE_EMBED_MODEL_PREFERENCES: readonly string[] = [
  "nvidia/llama-nemotron-embed-vl-1b-v2:free",
];

const FALLBACK_PAID_EMBED_MODEL = "openai/text-embedding-3-small" as const;

let cache: { model: string; at: number } | null = null;

function ttlMs(): number {
  const raw =
    process.env.CLEARBOLT_DEDUP_EMBED_MODEL_LIST_TTL_MS?.trim() ??
    process.env.CLEARBOLT_DEDUP_LLM_MODEL_LIST_TTL_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 6 * 60 * 60 * 1000;
  return Number.isFinite(n) && n >= 60_000 ? n : 6 * 60 * 60 * 1000;
}

/**
 * Picks a model from GET /api/v1/embeddings/models (no API key required).
 * Preference: {@link DEDUP_FREE_EMBED_MODEL_PREFERENCES}, then any other zero-priced text embedding,
 * then lowest positive `pricing.prompt` per million tokens (tie-break: shorter id).
 * On list failure or empty catalog, returns {@link FALLBACK_PAID_EMBED_MODEL} without caching.
 */
export async function resolveDedupEmbedOpenRouterModel(): Promise<string> {
  const now = Date.now();
  if (cache && now - cache.at < ttlMs()) return cache.model;

  let rows: OrEmbedModel[] = [];
  try {
    const res = await fetch(EMBEDDINGS_MODELS_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return FALLBACK_PAID_EMBED_MODEL;
    const body = (await res.json()) as { data?: OrEmbedModel[] };
    rows = Array.isArray(body.data) ? body.data : [];
  } catch {
    return FALLBACK_PAID_EMBED_MODEL;
  }

  const textEmbed = rows.filter(isTextEmbeddingModel);
  if (textEmbed.length === 0) return FALLBACK_PAID_EMBED_MODEL;

  const ids = new Set(textEmbed.map((m) => m.id));
  for (const pref of DEDUP_FREE_EMBED_MODEL_PREFERENCES) {
    if (ids.has(pref)) {
      cache = { model: pref, at: now };
      return pref;
    }
  }

  const freeRows = textEmbed.filter(isFreeEmbedding);
  freeRows.sort(
    (a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id),
  );
  const freePick = freeRows[0]?.id;
  if (freePick) {
    cache = { model: freePick, at: now };
    return freePick;
  }

  const paid = textEmbed
    .map((m) => ({ id: m.id, p: parsePromptPricePerMillion(m) }))
    .filter((x) => Number.isFinite(x.p) && x.p > 0)
    .sort(
      (a, b) =>
        a.p - b.p || a.id.length - b.id.length || a.id.localeCompare(b.id),
    );
  const paidPick = paid[0]?.id;
  if (paidPick) {
    cache = { model: paidPick, at: now };
    return paidPick;
  }

  return FALLBACK_PAID_EMBED_MODEL;
}

export function clearDedupEmbedModelCacheForTests(): void {
  cache = null;
}
